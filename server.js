const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');

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

// --- MULTI-LOBBY SYSTEM ---
const lobbies = new Map(); // lobbyId -> Lobby Object

// Generate 6-character alphanumeric Lobby ID
const generateLobbyId = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

const generateId = () => Math.random().toString(36).substr(2, 9);

// Admin kimlik bilgileri (Giriş yapmak için - Lobi oluşturma yetkisi verir)
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "12345";

const LOBBY_LIFETIME = 24 * 60 * 60 * 1000; // 24 saat

// Rate Limiting (Basit socket-tabanlı)
const joinAttempts = new Map(); // socketId -> { count, timestamp }

class Lobby {
    constructor(id, adminSocketId) {
        this.id = id;
        this.adminSocketId = adminSocketId;
        this.players = {}; // persistentId -> player
        this.questions = [];
        this.currentQuestionIndex = -1;
        this.answers = {}; // index -> { pid: answer }
        this.isGameActive = false;
        this.lobbyActive = true; 
        this.wheelSpinning = false;
        this.settings = {
            answerVisibility: 'public', // 'public' | 'admin_only'
            gameMode: 'manual', // 'manual' | 'random'
            anonymityMode: 'none' // 'none' | 'full'
        };
        this.createdAt = Date.now();
    }

    getSafePlayerList() {
        return Object.values(this.players)
            .filter(p => p.isConnected)
            .map(p => ({ name: p.name, id: p.persistentId }));
    }

    getPlayerBySocketId(socketId) {
        return Object.values(this.players).find(p => p.socketId === socketId);
    }
}

io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı:', socket.id);

    // --- GENEL ---
    
    // Admin Girişi (Sadece yetkilendirme için)
    socket.on('adminLogin', (data) => {
        console.log(`[LOGIN ATTEMPT] User: ${data.username}, Pass: ${data.password}`);
        if (data.username === ADMIN_USER && data.password === ADMIN_PASS) {
            console.log(`[LOGIN SUCCESS] Admin logged in with socket: ${socket.id}`);
            socket.emit('adminLoginSuccess');
        } else {
            console.log(`[LOGIN FAILED] Invalid credentials.`);
            socket.emit('adminLoginFail');
        }
    });

    // --- LOBİ YÖNETİMİ ---

    // Yeni Lobi Oluştur
    socket.on('createLobby', (data) => {
        // Yeni bir lobi ID üret
        let lobbyId = generateLobbyId();
        while (lobbies.has(lobbyId)) {
            lobbyId = generateLobbyId();
        }

        const lobby = new Lobby(lobbyId, socket.id);

        // Ayarları uygula
        lobby.questions = Array.isArray(data) ? data : (data.questions || []);
        lobby.settings.answerVisibility = (data.visibility === 'admin_only') ? 'admin_only' : 'public';
        lobby.settings.gameMode = data.gameMode || 'manual';
        lobby.settings.anonymityMode = data.anonymityMode || 'none';
        
        // Lobiyi kaydet
        lobbies.set(lobbyId, lobby);
        
        // Admin'i odaya al
        socket.join(lobbyId);
        socket.data.lobbyId = lobbyId;
        socket.data.isAdmin = true;

        console.log(`[LOBBY CREATED] ID: ${lobbyId}, Admin: ${socket.id}`);
        
        // Admin'e bildir
        socket.emit('lobbyCreated', { 
            lobbyId: lobbyId,
            settings: lobby.settings
        });
        
        socket.emit('updateVisibilitySettings', lobby.settings.answerVisibility);
    });

    // Oyuncu Girişi (Lobi ID ile)
    socket.on('playerJoin', (data) => {
        // data: { name, persistentId, lobbyId }
        
        // Rate Limit Kontrolü
        const attemptData = joinAttempts.get(socket.id) || { count: 0, timestamp: Date.now() };
        if (Date.now() - attemptData.timestamp > 60000) {
            // 1 dakika geçtiyse sıfırla
            attemptData.count = 0;
            attemptData.timestamp = Date.now();
        }
        
        if (attemptData.count >= 3) {
            socket.emit('error', 'Çok fazla deneme yaptınız. Lütfen bekleyiniz.');
            return;
        }

        const lobbyId = data.lobbyId ? data.lobbyId.toUpperCase() : null;
        
        if (!lobbyId) {
            attemptData.count++;
            joinAttempts.set(socket.id, attemptData);
            socket.emit('error', 'Lobi ID gereklidir.');
            return;
        }

        const lobby = lobbies.get(lobbyId);

        if (!lobby) {
            attemptData.count++;
            joinAttempts.set(socket.id, attemptData);
            socket.emit('error', 'Geçersiz Kod: Lobi bulunamadı!');
            return;
        }

        // Lobi Süresi Kontrolü
        if (Date.now() - lobby.createdAt > LOBBY_LIFETIME) {
            lobbies.delete(lobbyId); // Süresi dolmuş lobiyi temizle
            socket.emit('error', 'Bu lobinin süresi dolmuş.');
            return;
        }

        // Başarılı giriş - Sayacı sıfırla (veya azaltma yapma)
        // attemptData.count = 0; 
        
        if (!lobby.lobbyActive && !lobby.isGameActive) {
             socket.emit('error', 'Lobi şu an kapalı.');
             return;
        }

        // Socket'i odaya al
        socket.join(lobbyId);
        socket.data.lobbyId = lobbyId;
        socket.data.isAdmin = false;

        const name = data.name;
        let persistentId = data.persistentId;

        // Yeniden Bağlanma Kontrolü
        if (persistentId && lobby.players[persistentId]) {
            const player = lobby.players[persistentId];
            player.socketId = socket.id;
            player.isConnected = true;
            console.log(`Oyuncu tekrar bağlandı: ${player.name} (${persistentId}) -> Lobby: ${lobbyId}`);
            
            socket.emit('joinedLobby', { persistentId: player.persistentId, name: player.name, lobbyId: lobbyId });
            
            // Oyun durumunu restore et
            if (lobby.isGameActive) {
                const isWheelRound = (lobby.currentQuestionIndex >= 2) && (Math.random() < 0.3);
                socket.emit('newQuestion', {
                    question: lobby.questions[lobby.currentQuestionIndex],
                    index: lobby.currentQuestionIndex,
                    total: lobby.questions.length,
                    wheelChance: false
                });

                if (lobby.answers[lobby.currentQuestionIndex] && lobby.answers[lobby.currentQuestionIndex][persistentId]) {
                    socket.emit('answerReceived');
                }
            }
        } else {
            // Yeni Oyuncu
            if (!lobby.lobbyActive) {
                socket.emit('error', 'Oyun başladı, yeni giriş yapılamaz.');
                return;
            }

            const safeName = name.trim().slice(0, 15) || "Anonim";
            persistentId = generateId();
            
            lobby.players[persistentId] = {
                persistentId: persistentId,
                socketId: socket.id,
                name: safeName,
                score: 0,
                isConnected: true
            };

            console.log(`Yeni oyuncu: ${safeName} -> Lobby: ${lobbyId}`);
            socket.emit('joinedLobby', { persistentId: persistentId, name: safeName, lobbyId: lobbyId });
        }
        
        // Admin'e bildir
        io.to(lobby.adminSocketId).emit('updatePlayerList', lobby.getSafePlayerList());
    });

    // --- OYUN AKSİYONLARI ---
    // Helper: Socket'in bulunduğu lobiyi getir
    const getLobby = () => {
        const lid = socket.data.lobbyId;
        return lobbies.get(lid);
    };

    const verifyAdmin = (lobby) => {
        return lobby && lobby.adminSocketId === socket.id;
    };

    // Ayar Değiştirme
    socket.on('changeVisibility', (mode) => {
        const lobby = getLobby();
        if (!verifyAdmin(lobby)) return;
        lobby.settings.answerVisibility = mode;
        socket.emit('updateVisibilitySettings', lobby.settings.answerVisibility);
    });

    socket.on('changeAnonymity', (mode) => {
        const lobby = getLobby();
        if (!verifyAdmin(lobby)) return;
        lobby.settings.anonymityMode = mode;
        io.to(lobby.adminSocketId).emit('updatePlayerList', lobby.getSafePlayerList());
        socket.emit('updateAnonymitySettings', lobby.settings.anonymityMode);
    });

    // Oyunu Başlat
    socket.on('startGame', () => {
        const lobby = getLobby();
        if (!verifyAdmin(lobby)) return;
        
        lobby.lobbyActive = false; 
        lobby.isGameActive = true;
        lobby.currentQuestionIndex = 0;
        
        io.to(lobby.id).emit('newQuestion', {
            question: lobby.questions[0],
            index: 0,
            total: lobby.questions.length
        });
    });

    // Lobiyi Kapat (Admin)
    socket.on('closeLobby', () => {
        const lobby = getLobby();
        if (!verifyAdmin(lobby)) return;

        // Performans logları
        const memBefore = process.memoryUsage();
        console.log(`[LOBBY CLOSE] Lobby: ${lobby.id} kapatılıyor.`);

        // Tüm oyunculara bildir
        io.to(lobby.id).emit('lobbyClosed');
        
        // Lobiyi sil
        lobbies.delete(lobby.id);

        const memAfter = process.memoryUsage();
        console.log(`[METRICS] Bellek: ${(memBefore.heapUsed / 1024 / 1024).toFixed(2)} MB -> ${(memAfter.heapUsed / 1024 / 1024).toFixed(2)} MB`);
        
        // Admin state reset
        socket.data.lobbyId = null;
    });

    // Oyuncu Lobiden Çık (Manuel)
    socket.on('playerLeave', () => {
        const lobby = getLobby();
        if (!lobby) return;

        const player = lobby.getPlayerBySocketId(socket.id);
        if (player) {
            console.log(`Oyuncu ayrıldı: ${player.name} (Lobby: ${lobby.id})`);
            delete lobby.players[player.persistentId];
            
            if (lobby.adminSocketId) {
                io.to(lobby.adminSocketId).emit('updatePlayerList', lobby.getSafePlayerList());
                io.to(lobby.adminSocketId).emit('updateAnswerStatus', {
                    answered: 0, // Basitlik için sıfırlanabilir veya hesaplanabilir ama oyun içi çıkışlar nadir
                    total: lobby.getSafePlayerList().length
                });
            }
        }
    });

    // Sonraki Soru
    socket.on('nextQuestion', () => {
        const lobby = getLobby();
        if (!verifyAdmin(lobby)) return;

        lobby.currentQuestionIndex++;
        
        if (lobby.currentQuestionIndex >= lobby.questions.length) {
            io.to(lobby.id).emit('gameOver');
            lobby.isGameActive = false;
        } else {
            let isWheelRound = false;
            if (lobby.settings.gameMode !== 'manual') {
                isWheelRound = (lobby.currentQuestionIndex >= 2) && (Math.random() < 0.3);
            }
            
            io.to(lobby.id).emit('newQuestion', {
                question: lobby.questions[lobby.currentQuestionIndex],
                index: lobby.currentQuestionIndex,
                total: lobby.questions.length,
                wheelChance: isWheelRound 
            });
        }
    });

    // Cevapları Göster
    socket.on('revealAnswers', () => {
        const lobby = getLobby();
        if (!verifyAdmin(lobby)) return;
        
        const currentAnswers = lobby.answers[lobby.currentQuestionIndex] || {};
        const anonymousAnswers = Object.values(currentAnswers);
        
        socket.emit('showAnswers', anonymousAnswers); // Admine gönder
        
        if (lobby.settings.answerVisibility === 'public') {
            socket.broadcast.to(lobby.id).emit('showAnswers', anonymousAnswers);
        } else {
            socket.broadcast.to(lobby.id).emit('answersRevealedToAdmin');
        }
    });

    // Çark Döndür
    socket.on('spinWheel', () => {
        const lobby = getLobby();
        if (!verifyAdmin(lobby)) return;
        
        const activePlayers = Object.values(lobby.players).filter(p => p.isConnected);
        
        if (activePlayers.length === 0) {
            socket.emit('error', 'Çevirecek oyuncu yok!');
            return;
        }

        const winner = activePlayers[Math.floor(Math.random() * activePlayers.length)];
        
        let displayWinnerName = winner.name;
        let displayCandidates = activePlayers.map(p => p.name);

        if (lobby.settings.anonymityMode === 'full') {
            displayWinnerName = "Anonim";
            displayCandidates = activePlayers.map(() => "Anonim");
        }
        
        lobby.wheelSpinning = true;
        console.log(`[ÇARK] Lobby: ${lobby.id} - Kazanan: ${winner.name}`);

        io.to(lobby.id).emit('wheelResult', { 
            winnerId: winner.persistentId, 
            winnerName: displayWinnerName,
            candidates: displayCandidates,
            anonymityMode: lobby.settings.anonymityMode
        });
        
        if (lobby.settings.answerVisibility === 'admin_only') {
            const currentAnswers = lobby.answers[lobby.currentQuestionIndex] || {};
            const anonymousAnswers = Object.values(currentAnswers);
            io.to(winner.socketId).emit('enableSelection', anonymousAnswers);
        }
    });

    // Yazar İfşası
    socket.on('revealAuthor', (targetAnswerText) => {
        const lobby = getLobby();
        if (!lobby) return;

        const currentAnswers = lobby.answers[lobby.currentQuestionIndex];
        let authorName = "Bilinmiyor";
        
        if (currentAnswers) {
            for (const [pid, answer] of Object.entries(currentAnswers)) {
                if (answer === targetAnswerText) {
                    authorName = lobby.players[pid].name;
                    break;
                }
            }
        }
        
        io.to(lobby.id).emit('authorRevealed', { answer: targetAnswerText, author: authorName });
    });

    // Cevap Ver
    socket.on('submitAnswer', (answerText) => {
        const lobby = getLobby();
        if (!lobby || !lobby.isGameActive) return;
        
        const player = lobby.getPlayerBySocketId(socket.id);
        if (!player) return; // Oyuncu bulunamadı
        
        const pid = player.persistentId;

        if (!lobby.answers[lobby.currentQuestionIndex]) {
            lobby.answers[lobby.currentQuestionIndex] = {};
        }
        
        lobby.answers[lobby.currentQuestionIndex][pid] = answerText;
        
        const answerCount = Object.keys(lobby.answers[lobby.currentQuestionIndex]).length;
        const totalPlayers = Object.keys(lobby.players).filter(k => lobby.players[k].isConnected).length;
        
        io.to(lobby.adminSocketId).emit('updateAnswerStatus', { 
            answered: answerCount, 
            total: totalPlayers 
        });

        socket.emit('answerReceived');
    });

    socket.on('disconnect', () => {
        const lobby = getLobby();
        if (lobby) {
            if (verifyAdmin(lobby)) {
                 // Admin çıktı
                 console.log(`Admin disconnected from lobby ${lobby.id}`);
                 // Burada lobiyi kapatabiliriz veya bekletebiliriz. 
                 // Şimdilik açık kalsın, admin reconnect yaparsa tekrar yönetebilsin (socketId değişeceği için zor, reconnect logic lazım)
                 // Mevcut yapıda admin refresh atarsa lobby'yi kaybeder.
            } else {
                // Oyuncu çıktı
                const player = lobby.getPlayerBySocketId(socket.id);
                if (player) {
                    player.isConnected = false;
                    console.log(`Kullanıcı ayrıldı: ${player.name} (Lobby: ${lobby.id})`);
                    if (lobby.adminSocketId) {
                        io.to(lobby.adminSocketId).emit('updatePlayerList', lobby.getSafePlayerList());
                    }
                }
            }
        }
    });
});


// QR Code API
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
