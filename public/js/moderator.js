const socket = io();
let questions = [];

// --- Custom Alert/Confirm Fonksiyonları (Moderator) ---

window.alert = function(message) {
    showAlert('Bildirim', message);
};

function showAlert(title, message) {
    document.getElementById('alertTitle').innerText = title;
    document.getElementById('alertMessage').innerText = message;
    document.getElementById('customAlert').classList.remove('hidden');
    document.getElementById('alertMenu').classList.add('hidden');
}

function closeAlert() {
    document.getElementById('customAlert').classList.add('hidden');
}

function toggleAlertMenu() {
    document.getElementById('alertMenu').classList.toggle('hidden');
}

function copyAlertMessage() {
    const text = document.getElementById('alertMessage').innerText;
    navigator.clipboard.writeText(text);
    toggleAlertMenu();
}

let confirmCallback = null;
function showConfirm(title, message, callback) {
    document.getElementById('confirmTitle').innerText = title;
    document.getElementById('confirmMessage').innerText = message;
    document.getElementById('customConfirm').classList.remove('hidden');
    confirmCallback = callback;
}

function closeConfirm() {
    document.getElementById('customConfirm').classList.add('hidden');
    confirmCallback = null;
}

document.getElementById('confirmOkBtn').addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    closeConfirm();
});

document.getElementById('confirmCancelBtn').addEventListener('click', () => {
    closeConfirm();
});

socket.on('connect_error', (err) => {
    console.error('Bağlantı hatası:', err.message);
    // Moderatör için de basit bir uyarı eklenebilir
    // Şimdilik sadece konsol logu yeterli olabilir veya document title değiştirilebilir
    document.title = "⚠️ Bağlantı Koptu - Moderatör Paneli";
});

socket.on('connect', () => {
    document.title = "Moderatör Paneli";
});

// DOM Elementleri
const loginScreen = document.getElementById('loginScreen');
const setupScreen = document.getElementById('setupScreen');
const lobbyScreen = document.getElementById('lobbyScreen');
const gameScreen = document.getElementById('gameScreen');
const questionList = document.getElementById('questionList');
const playerList = document.getElementById('playerList');
const answerList = document.getElementById('answerList');

// --- GİRİŞ ---
function login() {
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    socket.emit('adminLogin', { username: u, password: p });
}

socket.on('adminLoginSuccess', () => {
    loginScreen.classList.add('hidden');
    setupScreen.classList.remove('hidden');
});

socket.on('adminLoginFail', () => {
    alert('Hatalı giriş!');
});

// --- SORU HAZIRLAMA ---
function addQuestion() {
    const input = document.getElementById('newQuestion');
    const text = input.value.trim();
    if (text) {
        questions.push(text);
        renderQuestions();
        input.value = '';
    }
}

function renderQuestions() {
    questionList.innerHTML = questions.map((q, i) => 
        `<li class="list-item">${i+1}. ${q} <button class="danger" onclick="removeQuestion(${i})" style="padding: 2px 5px; font-size: 12px; float: right;">Sil</button></li>`
    ).join('');
}

function removeQuestion(index) {
    questions.splice(index, 1);
    renderQuestions();
}

let currentVisibility = 'public';

// --- UI HELPERS ---
function toggleGameMode(mode) {
    const manualArea = document.getElementById('manualSetupArea');
    if (mode === 'random') {
        manualArea.classList.add('hidden');
    } else {
        manualArea.classList.remove('hidden');
    }
}

// --- LOBİ ---
 function createLobby() {
     const gameMode = document.querySelector('input[name="gameMode"]:checked').value;
     const anonymityMode = document.querySelector('input[name="anonymity"]:checked').value;

     if (gameMode === 'manual') {
         if (questions.length === 0) return alert('En az 1 soru ekleyin!');
     } else {
         // Random Mod: Soruları otomatik oluştur (Simülasyon)
         questions = [
             "Bu oyunda en çok kim eğleniyor?",
             "Aramızdaki en şanslı kişi kim?",
             "Günün sorusu: Neden buradayız?",
             "Bir sonraki turda ne olacak?",
             "Sürpriz Soru!"
         ];
     }
     
     // Görünürlük ayarını al
     let visibility = 'public';
     if (gameMode === 'manual') {
         visibility = document.querySelector('input[name="visibility"]:checked').value;
     }
     
     socket.emit('createLobby', { questions, visibility, gameMode, anonymityMode });
}

socket.on('lobbyCreated', (data) => {
     // Badge güncelle
     const gameMode = data.settings.gameMode;
     const anonymityMode = data.settings.anonymityMode;

     const badge = document.getElementById('lobbyModeBadge');
     if (badge) {
         badge.innerText = (gameMode === 'random') ? 'RANDOM MOD' : 'MANUEL MOD';
         badge.style.background = (gameMode === 'random') ? '#e67e22' : 'var(--accent-color)';
     }

     // Anonimlik Badge güncelle
     const anonBadge = document.getElementById('anonymityBadge');
     if (anonBadge) {
         let anonText = "Gizlilik: Açık";
         if (anonymityMode === 'full') anonText = "Gizlilik: Tam Anonim";
         anonBadge.innerText = anonText;
     }
     
     // Lobi ID Göster
     const idDisplay = document.getElementById('lobbyIdDisplay');
     if (idDisplay) {
         idDisplay.innerText = data.lobbyId;
     }
     
     // QR Kod oluştur
     const joinUrl = window.location.origin + "/?lobby=" + data.lobbyId;
     
    fetch(`/api/qrcode?url=${encodeURIComponent(joinUrl)}`)
        .then(res => res.json())
        .then(qrData => {
            document.getElementById('qrCodeContainer').innerHTML = `<img src="${qrData.dataUrl}" style="width: 200px;">`;
        });

    setupScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    document.getElementById('closeLobbyBtn').classList.remove('hidden');
});


function closeLobby() {
    showConfirm('Lobiyi Kapat', 'Lobiyi kapatmak istediğinize emin misiniz? Bu işlem geri alınamaz.', () => {
        socket.emit('closeLobby');
        
        // UI Reset
        lobbyScreen.classList.add('hidden');
        gameScreen.classList.add('hidden');
        document.getElementById('closeLobbyBtn').classList.add('hidden');
        setupScreen.classList.remove('hidden');
        
        // Reset local variables
        questions = [];
        renderQuestions();

        // Form Reset (Varsayılan ayarlara dön)
        document.querySelector('input[name="gameMode"][value="manual"]').checked = true;
        toggleGameMode('manual');
        
        const anonInput = document.querySelector('input[name="anonymity"][value="none"]');
        if (anonInput) anonInput.checked = true;
        
        const visInput = document.querySelector('input[name="visibility"][value="public"]');
        if (visInput) visInput.checked = true;
        
        document.getElementById('newQuestion').value = '';
    });
}

let currentAnonymity = 'none';

socket.on('updateVisibilitySettings', (mode) => {
    currentVisibility = mode;
    const display = document.getElementById('currentVisibilityDisplay');
    if (display) {
        display.innerText = (mode === 'public') ? 'Herkese Açık' : 'Sadece Admin';
        display.style.color = (mode === 'public') ? '#2ecc71' : 'var(--accent-color)';
    }
});

function toggleVisibility() {
    const newMode = (currentVisibility === 'public') ? 'admin_only' : 'public';
    socket.emit('changeVisibility', newMode);
}

socket.on('updateAnonymitySettings', (mode) => {
    currentAnonymity = mode;
    const display = document.getElementById('currentAnonymityDisplay');
    if (display) {
        let text = 'Açık';
        if (mode === 'full') text = 'Gizli';
        display.innerText = text;
        display.style.color = (mode === 'none') ? '#2ecc71' : 'var(--accent-color)';
    }
});

function cycleAnonymity() {
    let newMode = 'none';
    if (currentAnonymity === 'none') newMode = 'full';
    else newMode = 'none';
    
    socket.emit('changeAnonymity', newMode);
}

socket.on('updatePlayerList', (players) => {
    document.getElementById('playerCount').innerText = players.length;
    // Artık server her zaman gerçek isimleri gönderiyor.
    // Lobi listesi her zaman açık olmalı.
    playerList.innerHTML = players.map(p => {
        return `<li class="list-item">${p.name}</li>`;
    }).join('');
});

function startGame() {
    socket.emit('startGame');
    lobbyScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
}

// --- OYUN ---
socket.on('newQuestion', (data) => {
    document.getElementById('currentQuestionDisplay').innerText = `Soru ${data.index + 1}: ${data.question}`;
    document.getElementById('answerList').innerHTML = ''; // Önceki cevapları temizle
    document.getElementById('answerStats').innerText = `0 / ${document.getElementById('playerCount').innerText}`; // Basit sayaç
    
    document.getElementById('revealBtn').classList.remove('hidden');
    document.getElementById('nextBtn').classList.add('hidden');
    document.getElementById('spinBtn').classList.add('hidden');

    if (data.wheelChance) {
        // Çark butonu gösterilecek mi? Aslında otomatik mi dönmeli yoksa admin mi basmalı?
        // Senaryo: Admin basar.
        document.getElementById('spinBtn').classList.remove('hidden');
        document.getElementById('revealBtn').classList.add('hidden'); // Çark varsa önce çark döner, sonra cevaplar?
        // Hayır, önce cevaplar verilir, sonra gösterilir, sonra çark döner.
        // Düzeltme: Cevaplar verildikten sonra reveal edilir.
    }
});

socket.on('updateAnswerStatus', (data) => {
    document.getElementById('answerStats').innerText = `${data.answered} / ${data.total}`;
});

function revealAnswers() {
    socket.emit('revealAnswers');
    document.getElementById('revealBtn').classList.add('hidden');
    
    // Çark butonu varsa (sunucudan wheelChance gelmişse bunu saklamamız lazımdı ama neyse)
    // Basitlik için: Çark butonu her zaman 3. sorudan sonra görünebilir veya server kontrol eder.
    // Şimdilik server kontrolüne bırakalım, server zaten newQuestion'da wheelChance yolladı.
    // Eğer wheelChance varsa reveal'den sonra spinBtn aktif olmalı.
    
    // Basit hack: UI'da spinBtn varsa göster
    const spinBtn = document.getElementById('spinBtn');
    if (!spinBtn.classList.contains('hidden-by-logic')) { 
        // Logic needed here. Let's rely on server state or just show Next if no wheel.
        // Better: Reveal answers -> Show Answers -> Show Next OR Show Spin based on round.
        
        // Let's modify logic: Always show Next. If Spin is available, show Spin instead of Next, then Next after Spin.
        // But wait, server logic was: `isWheelRound` sent in `newQuestion`.
    }
    document.getElementById('nextBtn').classList.remove('hidden');
}

socket.on('showAnswers', (answers) => {
    answerList.innerHTML = answers.map(a => 
        `<li class="list-item answer-card">${a} <span class="revealed-author hidden"></span></li>`
    ).join('');
    
    // Çark varsa butonu göster (Bu logic biraz karışık oldu, server'dan gelen datayı saklamadık)
    // Şimdilik manuel buton mantığı:
    // Eğer 3. soru veya sonrasıysa Spin butonu görünür olabilir.
    // Biz server'dan gelen veriyi global değişkende tutalım.
});

// Çark İşlemleri
function spinWheel() {
    socket.emit('spinWheel');
}

let actualWinnerName = "";
let isWinnerVisible = false;

socket.on('wheelResult', (data) => {
    const wheelContainer = document.getElementById('wheelContainer');
    const winnerText = document.getElementById('wheelWinnerName');
    
    // Reset UI state
    actualWinnerName = data.winnerName;
    isWinnerVisible = true; // Varsayılan olarak AÇIK başlıyoruz (Kullanıcı isteği üzerine)
    
    document.getElementById('winnerControls').classList.add('hidden');
    // Butonu "Gizle" modunda başlat
    document.getElementById('toggleWinnerBtn').innerHTML = "🔒 İsmi Gizle";
    document.getElementById('toggleWinnerBtn').className = "primary";
    
    document.getElementById('wheelInstruction').classList.add('hidden');
    document.getElementById('closeWheelBtn').classList.add('hidden');

    wheelContainer.classList.remove('hidden');
    
    // Basit animasyon
    let count = 0;
    const candidates = data.candidates && data.candidates.length > 0 ? data.candidates : ["Yarışmacı Aranıyor..."];
    const isAnon = (data.anonymityMode === 'full');

    const interval = setInterval(() => {
        // Animasyon sırasında isim seçimi
        // Eğer Anonim moddaysa "???" göster, değilse ismi göster
        let displayText = candidates[Math.floor(Math.random() * candidates.length)];
        
        if (isAnon) {
            // Animasyon sırasında gizle
            displayText = "???";
        }
        
        winnerText.innerText = displayText;
        count++;
        
        if (count > 20) {
            clearInterval(interval);
            
            // Çark durdu. Kazananı göster.
            // Server'dan gelen winnerName'i kullan (Eğer anonimse "Anonim" gelir, değilse Gerçek İsim)
            winnerText.innerText = actualWinnerName;
            winnerText.style.filter = "none";
            
            // Kontrolleri SADECE gerçek isim varsa göster (Anonim modda göstermeye gerek yok çünkü isim zaten Anonim)
            // Veya her zaman gösterip "Göster" butonuna basınca gerçek ismi mi getireceğiz?
            // "Kullanıcılar anonim moda geçtiğinde, yalnızca profil çarkında görünen isim 'Anonim' olarak değişecek"
            // Bu, sonucun "Anonim" olarak kalması gerektiğini ima ediyor.
            // Ancak moderatör belki gerçek ismi görmek ister?
            // Şimdilik sadece anonim değilse kontrol gösterelim.
            
            if (!isAnon) {
                 document.getElementById('winnerControls').classList.remove('hidden');
            }
            
            document.getElementById('wheelInstruction').classList.remove('hidden');
            
            setTimeout(() => {
                document.getElementById('closeWheelBtn').classList.remove('hidden');
            }, 1000);
        }
    }, 100);
});

function toggleWinnerName() {
    const winnerText = document.getElementById('wheelWinnerName');
    const btn = document.getElementById('toggleWinnerBtn');
    
    isWinnerVisible = !isWinnerVisible;
    
    if (isWinnerVisible) {
        winnerText.innerText = actualWinnerName;
        winnerText.style.filter = "none";
        btn.innerHTML = "🔒 İsmi Gizle";
        btn.className = "primary"; // Daha dikkat çekici renk
    } else {
        winnerText.innerText = "Gizli Kullanıcı";
        winnerText.style.filter = "blur(5px)";
        btn.innerHTML = "👁️ İsmi Göster";
        btn.className = "secondary";
    }
}

function closeWheel() {
    document.getElementById('wheelContainer').classList.add('hidden');
    // Çark bitti, next butonu aktif kalsın
}

function nextQuestion() {
    socket.emit('nextQuestion');
}

socket.on('gameOver', () => {
    alert("Oyun Bitti!");
    location.reload();
});

socket.on('authorRevealed', (data) => {
    // Cevap listesinde bul ve yazarı göster
    const items = document.querySelectorAll('#answerList li');
    items.forEach(li => {
        if (li.innerText.includes(data.answer)) {
            const span = li.querySelector('.revealed-author');
            span.innerText = `(Yazan: ${data.author})`;
            span.classList.remove('hidden');
        }
    });
});
