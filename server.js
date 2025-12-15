const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');
// const { v4: uuidv4 } = require('uuid'); // UUID kütüphanesi yoksa npm install uuid yapacağız veya basit bir random ID kullanacağız.

// UUID kurulumu yapılmadığı için basit bir unique ID üreteci kullanalım
const generateId = () => Math.random().toString(36).substr(2, 9);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000, // 60 saniye
    pingInterval: 25000 // 25 saniye
});

// Statik dosyalar
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Oyun Durumu (Basitçe bellekte tutuyoruz)
let gameState = {
    questions: [], // { id: 1, text: "Soru?" }
    currentQuestionIndex: -1, // -1: Başlamadı
    players: {}, // socketId -> { name: "Ali", score: 0 } 
    // YENİ YAPI: persistentId -> { socketId: "...", name: "Ali", score: 0, isConnected: true }
    answers: {}, // questionIndex -> { persistentId: "Cevap" }
    isGameActive: false,
    lobbyActive: false,
    wheelSpinning: false,
    answerVisibility: 'public', // 'public' | 'admin_only'
    gameMode: 'manual', // 'manual' | 'random'
    anonymityMode: 'none' // 'none' | 'full'
};

// Admin kimlik bilgileri (Basitlik için hardcoded)
const ADMIN_USER = "admin";
const ADMIN_PASS = "12345";
let adminSocketId = null;

// Yardımcı Fonksiyonlar
function getPlayerBySocketId(socketId) {
    return Object.values(gameState.players).find(p => p.socketId === socketId);
}

function getSafePlayerList() {
    // Admin her zaman gerçek isimleri görür (bu fonksiyon admin'e gönderiliyorsa)
    // Ancak bu fonksiyonu genel kullanım için tanımlamıştık.
    // YENİ KURAL: Anonim mod sadece çarkı etkiler, lobi listesini etkilemez.
    // Bu yüzden burada isimleri maskelemiyoruz.
    
    return Object.values(gameState.players)
        .filter(p => p.isConnected)
        .map(p => ({ name: p.name, id: p.persistentId }));
}

io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı:', socket.id);

    // --- GENEL ---
    
    // Admin Girişi
    socket.on('adminLogin', (data) => {
        console.log(`[LOGIN ATTEMPT] User: ${data.username}, Pass: ${data.password}`);
        if (data.username === ADMIN_USER && data.password === ADMIN_PASS) {
            adminSocketId = socket.id;
            console.log(`[LOGIN SUCCESS] Admin logged in with socket: ${socket.id}`);
            socket.emit('adminLoginSuccess');
            // Mevcut durumu gönder
            socket.emit('updatePlayerList', getSafePlayerList());
            // Mevcut ayarı gönder
            socket.emit('updateVisibilitySettings', gameState.answerVisibility);
        } else {
            console.log(`[LOGIN FAILED] Invalid credentials.`);
            socket.emit('adminLoginFail');
        }
    });

    // Oyuncu Girişi (YENİLENMİŞ)
    socket.on('playerJoin', (data) => {
        // data: { name: "Ali", persistentId: "..." (varsa) }
        
        if (!gameState.lobbyActive && !gameState.isGameActive) {
             // Oyun/Lobi aktif değilse reddet
             socket.emit('error', 'Lobi şu an kapalı.');
             return;
        }

        const name = data.name;
        let persistentId = data.persistentId;

        // Yeniden Bağlanma Kontrolü
        if (persistentId && gameState.players[persistentId]) {
            // Eski oyuncu geri döndü
            const player = gameState.players[persistentId];
            player.socketId = socket.id;
            player.isConnected = true;
            console.log(`Oyuncu tekrar bağlandı: ${player.name} (${persistentId})`);
            
            socket.emit('joinedLobby', { persistentId: player.persistentId, name: player.name });
            
            // Oyun durumunu restore et
            if (gameState.isGameActive) {
                // Mevcut soruyu gönder
                const isWheelRound = (gameState.currentQuestionIndex >= 2) && (Math.random() < 0.3); // Bu logic biraz hatalı, server tarafında wheel durumu saklanmalıydı.
                // Basitlik için wheelChance'i false gönderelim veya global bir state'e taşıyalım. 
                // Şimdilik sadece soruyu gönderelim.
                
                socket.emit('newQuestion', {
                    question: gameState.questions[gameState.currentQuestionIndex],
                    index: gameState.currentQuestionIndex,
                    total: gameState.questions.length,
                    wheelChance: false // Tekrar bağlanınca çark animasyonunu tekrar oynatmayalım
                });

                // Eğer bu soruya cevap vermişse bildirelim (Frontend'de input kilitli kalsın)
                if (gameState.answers[gameState.currentQuestionIndex] && gameState.answers[gameState.currentQuestionIndex][persistentId]) {
                    socket.emit('answerReceived');
                }
            } else if (gameState.lobbyActive) {
                 // Sadece lobide bekliyor
            }

        } else {
            // Yeni Oyuncu
            if (!gameState.lobbyActive) {
                socket.emit('error', 'Oyun başladı, yeni giriş yapılamaz.');
                return;
            }

            const safeName = name.trim().slice(0, 15) || "Anonim";
            persistentId = generateId();
            
            gameState.players[persistentId] = {
                persistentId: persistentId,
                socketId: socket.id,
                name: safeName,
                score: 0,
                isConnected: true
            };

            socket.emit('joinedLobby', { persistentId: persistentId, name: safeName });
        }
        
        // Admin'e bildir
        if (adminSocketId) {
            io.to(adminSocketId).emit('updatePlayerList', getSafePlayerList());
        }
    });

    // --- MODERATÖR AKSİYONLARI ---

    // Soruları Kaydet ve Lobiyi Aç
    socket.on('createLobby', async (data) => {
        if (socket.id !== adminSocketId) return;
        
        const questions = Array.isArray(data) ? data : data.questions;
        const visibility = (data.visibility === 'admin_only') ? 'admin_only' : 'public';
        const gameMode = data.gameMode || 'manual';
        const anonymityMode = data.anonymityMode || 'none';

        gameState.questions = questions;
        gameState.answerVisibility = visibility;
        gameState.gameMode = gameMode;
        gameState.anonymityMode = anonymityMode;
        gameState.lobbyActive = true;
        gameState.currentQuestionIndex = -1;
        gameState.players = {}; 
        gameState.answers = {};
        
        io.emit('lobbyOpened');
        socket.emit('updateVisibilitySettings', gameState.answerVisibility);
    });
    
    // Ayar Değiştirme
    socket.on('changeVisibility', (mode) => {
        if (socket.id !== adminSocketId) return;
        gameState.answerVisibility = mode;
        socket.emit('updateVisibilitySettings', gameState.answerVisibility);
    });

    // Anonimlik Değiştirme (İsteğe bağlı, oyun içinde değiştirmek için)
    socket.on('changeAnonymity', (mode) => {
        if (socket.id !== adminSocketId) return;
        gameState.anonymityMode = mode;
        
        // Listeyi güncelle
        io.to(adminSocketId).emit('updatePlayerList', getSafePlayerList());
        socket.emit('updateAnonymitySettings', gameState.anonymityMode); // Frontend listener lazım
    });

    // Oyunu Başlat
    socket.on('startGame', () => {
        if (socket.id !== adminSocketId) return;
        
        gameState.lobbyActive = false; 
        gameState.isGameActive = true;
        gameState.currentQuestionIndex = 0;
        
        io.emit('newQuestion', {
            question: gameState.questions[0],
            index: 0,
            total: gameState.questions.length
        });
    });

    // Lobiyi Kapat (Admin)
    socket.on('closeLobby', () => {
        if (socket.id !== adminSocketId) return;

        // 1. Performans Analizi (Önce)
        const memBefore = process.memoryUsage();
        console.log(`[DB OPTIMIZATION] Lobi kapatma işlemi başlatıldı.`);
        console.log(`[METRICS] Başlangıç Bellek Kullanımı: ${(memBefore.heapUsed / 1024 / 1024).toFixed(2)} MB`);

        // 2. Veritabanı Bağlantısını Sıfırla (State Reset)
        // Mevcut referansları kopararak Garbage Collector'ın işini kolaylaştır
        gameState = {
            questions: [], 
            currentQuestionIndex: -1, 
            players: {}, 
            answers: {}, 
            isGameActive: false,
            lobbyActive: false,
            wheelSpinning: false,
            answerVisibility: 'public',
            gameMode: 'manual',
            anonymityMode: 'none'
        };

        // 3. Kaynakları Serbest Bırak
        // (Node.js otomatik yönetir ama manuel tetikleme denemesi yapılabilir - genelde gerekmez)
        // Eğer --expose-gc ile çalıştırılsaydı global.gc() çağırılabilirdi.
        
        // Tüm oyunculara bildir
        io.emit('lobbyClosed');

        // 4. Performans Analizi (Sonra)
        const memAfter = process.memoryUsage();
        console.log(`[DB OPTIMIZATION] Veritabanı (GameState) tamamen sıfırlandı.`);
        console.log(`[METRICS] Bitiş Bellek Kullanımı: ${(memAfter.heapUsed / 1024 / 1024).toFixed(2)} MB`);
        console.log(`[SUCCESS] Sistem rahatlatıldı ve yeni oturum için hazır.`);
    });

    // Oyuncu Lobiden Çık (Manuel)
    socket.on('playerLeave', () => {
        const player = getPlayerBySocketId(socket.id);
        if (player) {
            console.log(`Oyuncu ayrıldı (Manuel): ${player.name}`);
            delete gameState.players[player.persistentId];
            
            if (adminSocketId) {
                io.to(adminSocketId).emit('updatePlayerList', getSafePlayerList());
                io.to(adminSocketId).emit('updateAnswerStatus', {
                    answered: 0, 
                    total: getSafePlayerList().length
                });
            }
        }
    });


    // Sonraki Soru
    socket.on('nextQuestion', () => {
        if (socket.id !== adminSocketId) return;

        gameState.currentQuestionIndex++;
        
        if (gameState.currentQuestionIndex >= gameState.questions.length) {
            io.emit('gameOver');
            gameState.isGameActive = false;
        } else {
            // Manuel modda otomatik çark şansı olmasın
            let isWheelRound = false;
            if (gameState.gameMode !== 'manual') {
                isWheelRound = (gameState.currentQuestionIndex >= 2) && (Math.random() < 0.3);
            }
            
            io.emit('newQuestion', {
                question: gameState.questions[gameState.currentQuestionIndex],
                index: gameState.currentQuestionIndex,
                total: gameState.questions.length,
                wheelChance: isWheelRound 
            });
        }
    });

    // Cevapları Göster
    socket.on('revealAnswers', () => {
        if (socket.id !== adminSocketId) return;
        
        const currentAnswers = gameState.answers[gameState.currentQuestionIndex] || {};
        const anonymousAnswers = Object.values(currentAnswers);
        
        socket.emit('showAnswers', anonymousAnswers);
        
        if (gameState.answerVisibility === 'public') {
            socket.broadcast.emit('showAnswers', anonymousAnswers);
        } else {
            socket.broadcast.emit('answersRevealedToAdmin');
        }
    });

    // Çark Döndür
    socket.on('spinWheel', () => {
        if (socket.id !== adminSocketId) {
            console.warn(`Yetkisiz çark çevirme denemesi! IP: ${socket.handshake.address}`);
            return;
        }
        
        // Sadece bağlı oyuncular arasından seç
        const activePlayers = Object.values(gameState.players).filter(p => p.isConnected);
        
        if (activePlayers.length === 0) {
            socket.emit('error', 'Çevirecek oyuncu yok!');
            return;
        }

        const winner = activePlayers[Math.floor(Math.random() * activePlayers.length)];
        
        // Anonimlik Modu Kontrolü
        // YENİ KURAL: Sadece çarkta görünen isim "Anonim" olur.
        // Güvenlik için candidates listesini de maskeliyoruz.
        
        let displayWinnerName = winner.name;
        let displayCandidates = activePlayers.map(p => p.name);

        if (gameState.anonymityMode === 'full') {
            displayWinnerName = "Anonim";
            // Candidates listesini de "Anonim" ile doldur veya boş bırak, 
            // ama client tarafında "???" animasyonu için bir şeyler göndermemiz gerekebilir.
            // Client tarafı zaten anonymityMode='full' ise "???" gösteriyor.
            // Biz yine de veri sızdırmamak için gerçek isimleri göndermeyelim.
            displayCandidates = activePlayers.map(() => "Anonim");
        }
        
        gameState.wheelSpinning = true;
        
        // LOGLAMA
        console.log(`[ÇARK] ${new Date().toISOString()} - Admin çarkı çevirdi. Kazanan: ${winner.name} (${winner.persistentId})`);

        io.emit('wheelResult', { 
            winnerId: winner.persistentId, 
            winnerName: displayWinnerName,
            candidates: displayCandidates,
            anonymityMode: gameState.anonymityMode
        });
        
        // Eğer görünürlük 'admin_only' ise, kazanana özel olarak cevapları gönder ki seçebilsin
        if (gameState.answerVisibility === 'admin_only') {
            const currentAnswers = gameState.answers[gameState.currentQuestionIndex] || {};
            const anonymousAnswers = Object.values(currentAnswers);
            io.to(winner.socketId).emit('enableSelection', anonymousAnswers);
        }
    });

    // Yazar İfşası
    socket.on('revealAuthor', (targetAnswerText) => {
        const currentAnswers = gameState.answers[gameState.currentQuestionIndex];
        let authorName = "Bilinmiyor";
        
        for (const [pid, answer] of Object.entries(currentAnswers)) {
            if (answer === targetAnswerText) {
                authorName = gameState.players[pid].name;
                break;
            }
        }
        
        io.emit('authorRevealed', { answer: targetAnswerText, author: authorName });
    });

    // --- OYUNCU AKSİYONLARI ---

    // Cevap Ver
    socket.on('submitAnswer', (answerText) => {
        if (!gameState.isGameActive) return;
        
        const player = getPlayerBySocketId(socket.id);
        if (!player) return; // Oyuncu bulunamadı
        
        const pid = player.persistentId;

        if (!gameState.answers[gameState.currentQuestionIndex]) {
            gameState.answers[gameState.currentQuestionIndex] = {};
        }
        
        gameState.answers[gameState.currentQuestionIndex][pid] = answerText;
        
        const answerCount = Object.keys(gameState.answers[gameState.currentQuestionIndex]).length;
        const totalPlayers = Object.keys(gameState.players).filter(k => gameState.players[k].isConnected).length; // Aktif oyunculara göre oranla
        
        io.to(adminSocketId).emit('updateAnswerStatus', { 
            answered: answerCount, 
            total: totalPlayers 
        });

        socket.emit('answerReceived');
    });

    socket.on('disconnect', () => {
        console.log('Kullanıcı ayrıldı:', socket.id);
        
        const player = getPlayerBySocketId(socket.id);
        if (player) {
            player.isConnected = false;
            // Oyuncuyu hemen silmiyoruz!
            // Admin listesini güncelle (Offline olarak gösterebiliriz veya listeden geçici kaldırabiliriz)
            // Şimdilik listeden düşürelim ama hafızada kalsın
            if (adminSocketId) {
                io.to(adminSocketId).emit('updatePlayerList', getSafePlayerList());
            }
        }
    });
});


// QR Code API (İsteğe bağlı, frontend kütüphanesi de kullanılabilir ama sunucuda da dursun)
app.get('/api/qrcode', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).send('URL required');
        const qr = await QRCode.toDataURL(url);
        res.json({ dataUrl: qr });
    } catch (err) {
        res.status(500).send('Error generating QR');
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
});
