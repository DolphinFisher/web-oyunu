// Backend URL'i (Railway) - Netlify için gerekli
const RAILWAY_URL = "https://web-production-9dab5.up.railway.app";

let socket;

// Eğer Netlify üzerinden giriliyorsa Railway sunucusuna bağlan
if (window.location.hostname.includes('netlify.app')) {
    console.log("Netlify ortamı algılandı, Railway backend'ine bağlanılıyor...");
    socket = io(RAILWAY_URL, { transports: ['websocket', 'polling'] });
} else {
    // Localhost veya Railway üzerinden giriliyorsa otomatik algıla
    socket = io();
}

// DOM
const joinScreen = document.getElementById('joinScreen');
const waitingScreen = document.getElementById('waitingScreen');
const questionScreen = document.getElementById('questionScreen');
const resultScreen = document.getElementById('resultScreen');
const wheelOverlay = document.getElementById('wheelOverlay');
const gameOverScreen = document.getElementById('gameOverScreen');

// Durum
let isMyTurnToPick = false;
let myPersistentId = localStorage.getItem('player_pid');
let myName = localStorage.getItem('player_name');
let myLobbyId = localStorage.getItem('player_lobby');

// Bildirim Değişkenleri
// (Temizlendi)
// Bildirim fonksiyonları kaldırıldı.

// --- Custom Alert Fonksiyonları ---

// Varsayılan alert'i override et
window.alert = function(message) {
    showAlert('Bildirim', message);
};

function showAlert(title, message) {
    document.getElementById('alertTitle').innerText = title;
    document.getElementById('alertMessage').innerText = message;
    document.getElementById('customAlert').classList.remove('hidden');
    // Menüyü kapalı başlat
    document.getElementById('alertMenu').classList.add('hidden');
}

function closeAlert() {
    document.getElementById('customAlert').classList.add('hidden');
}

function toggleAlertMenu() {
    const menu = document.getElementById('alertMenu');
    menu.classList.toggle('hidden');
}

function copyAlertMessage() {
    const text = document.getElementById('alertMessage').innerText;
    navigator.clipboard.writeText(text).then(() => {
        // Geçici olarak butonu değiştir
        const btn = document.querySelector('#alertMenu button:first-child');
        const originalText = btn.innerText;
        btn.innerText = "Kopyalandı!";
        setTimeout(() => {
            btn.innerText = originalText;
            toggleAlertMenu(); // Menüyü kapat
        }, 1000);
    });
}

// Custom Confirm Fonksiyonu
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

// Socket Listener'ları

// Sayfa yüklendiğinde otomatik bağlanmayı dene
window.addEventListener('load', () => {
    // URL Parametrelerini Kontrol Et
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyIdParam = urlParams.get('lobby'); // veya 'code'
    
    if (lobbyIdParam) {
        // Eğer URL'de kod varsa direkt input alanını aç ve doldur
        showCodeInput();
        const input = document.getElementById('lobbyIdInput');
        if (input) input.value = lobbyIdParam;
    }

    if (myPersistentId && myName && myLobbyId) {
        console.log("Eski oturum bulundu, yeniden bağlanılıyor...", myPersistentId);
        // Otomatik bağlanma durumunda da lobi kontrol edilecek (sunucu tarafında)
        // Ancak URL'den gelen yeni bir lobi kodu varsa öncelik onda olmalı mı?
        // Genelde QR kod okutulduysa yeni bir oyuna girmek isteniyordur.
        
        if (lobbyIdParam && lobbyIdParam !== myLobbyId) {
            // Farklı bir lobiye girmeye çalışıyor, eski oturumu yoksay
            console.log("Yeni lobi algılandı, eski oturum yoksayılıyor.");
        } else {
             socket.emit('playerJoin', { name: myName, persistentId: myPersistentId, lobbyId: myLobbyId });
        }
    }
});

function showCodeInput() {
    document.getElementById('initialOptions').classList.add('hidden');
    document.getElementById('manualEntryArea').classList.remove('hidden');
}

function cancelManualEntry() {
    document.getElementById('manualEntryArea').classList.add('hidden');
    document.getElementById('initialOptions').classList.remove('hidden');
}

function joinGame() {
    const name = document.getElementById('playerName').value;
    const lobbyId = document.getElementById('lobbyIdInput').value.trim().toUpperCase();
    
    if (!lobbyId) return alert("Lobi kodu giriniz!");
    if (lobbyId.length < 6) return alert("Lobi kodu en az 6 karakter olmalıdır!");
    if (!name) return alert("İsim giriniz!");
    
    // Yeni giriş
    socket.emit('playerJoin', { name: name, persistentId: null, lobbyId: lobbyId });
}

socket.on('joinedLobby', (data) => {
    // Sunucudan gelen ID'yi sakla
    if (data.persistentId) {
        myPersistentId = data.persistentId;
        myName = data.name;
        myLobbyId = data.lobbyId;
        
        localStorage.setItem('player_pid', myPersistentId);
        localStorage.setItem('player_name', myName);
        localStorage.setItem('player_lobby', myLobbyId);
    }
    
    // URL güncelle (kolay paylaşım için)
    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?lobby=' + myLobbyId;
    window.history.pushState({path:newUrl},'',newUrl);

    joinScreen.classList.add('hidden');
    waitingScreen.classList.remove('hidden');
    
    // Çıkış butonunu göster
    document.getElementById('leaveLobbyBtn').classList.remove('hidden');
});

function leaveLobby() {
    showConfirm('Çıkış', 'Lobiden çıkmak istediğinize emin misiniz?', () => {
        socket.emit('playerLeave');
        
        // Local storage temizle
        localStorage.removeItem('player_pid');
        localStorage.removeItem('player_name');
        localStorage.removeItem('player_lobby');
        myPersistentId = null;
        myName = null;
        myLobbyId = null;

        // UI Sıfırla
        resetUI();
    });
}

function resetUI() {
    document.getElementById('leaveLobbyBtn').classList.add('hidden');
    waitingScreen.classList.add('hidden');
    questionScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    joinScreen.classList.remove('hidden');
    document.getElementById('playerName').value = '';
}

socket.on('lobbyClosed', () => {
    // Local storage temizle
    localStorage.removeItem('player_pid');
    localStorage.removeItem('player_name');
    myPersistentId = null;
    myName = null;

    // Tam temizlik için sayfayı yenile
    // Ancak kullanıcıya kısa bir bilgi verelim
    alert('Lobi moderatör tarafından kapatıldı. Ana sayfaya yönlendiriliyorsunuz.');
    window.location.reload();
});

socket.on('error', (msg) => {
    alert(msg);
    // Hata varsa storage temizle (örn: oyun bitmiş olabilir)
    // Ama "Lobi kapalı" gibi hatalarda silmek iyi olmayabilir, duruma göre.
    // Şimdilik silmeyelim, kullanıcı manuel silsin veya yeni isim girsin.
});

socket.on('connect_error', (err) => {
    console.error('Bağlantı hatası:', err.message);
    const statusDiv = document.getElementById('statusMessage');
    if (statusDiv) {
        statusDiv.style.display = 'block';
        statusDiv.style.color = 'red';
        statusDiv.innerText = 'Bağlantı koptu, yeniden bağlanılıyor...';
    }
});

socket.on('connect', () => {
    console.log('Bağlandı');
    const statusDiv = document.getElementById('statusMessage');
    if (statusDiv && statusDiv.innerText.includes('Bağlantı koptu')) {
        statusDiv.style.display = 'none';
        statusDiv.style.color = 'green';
        statusDiv.innerText = 'Cevabınız gönderildi, bekleyiniz.';
    }
});

socket.on('newQuestion', (data) => {
    waitingScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    questionScreen.classList.remove('hidden');
    
    document.getElementById('questionText').innerText = data.question;
    document.getElementById('answerInput').value = '';
    document.getElementById('statusMessage').style.display = 'none';
    document.querySelector('#questionScreen button').disabled = false;
});

socket.on('answerReceived', () => {
    document.getElementById('statusMessage').style.display = 'block';
    document.querySelector('#questionScreen button').disabled = true;
});

function submitAnswer() {
    const text = document.getElementById('answerInput').value;
    if (!text) return;
    
    socket.emit('submitAnswer', text);
    // UI update 'answerReceived' event'ine taşındı, çünkü restore durumunda da tetiklenebilir
}

socket.on('showAnswers', (answers) => {
    questionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    
    const container = document.getElementById('publicAnswers');
    container.innerHTML = answers.map(a => 
        `<div class="answer-card" onclick="pickAnswer('${a}')">${a} <span class="author-tag hidden"></span></div>`
    ).join('');
});

socket.on('answersRevealedToAdmin', () => {
    questionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    
    const container = document.getElementById('publicAnswers');
    container.innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--text-color);">
            <h3>Cevaplar İnceleniyor</h3>
            <p>Cevaplar sadece moderatör ekranında görüntülenmektedir.</p>
            <div class="loader" style="margin: 20px auto;">🔒</div>
        </div>
    `;
});

socket.on('enableSelection', (answers) => {
    // Kazanan kişi için özel olarak cevapları göster
    const container = document.getElementById('publicAnswers');
    container.innerHTML = answers.map(a => 
        `<div class="answer-card" onclick="pickAnswer('${a}')">${a} <span class="author-tag hidden"></span></div>`
    ).join('');
    
    // Görünürlüğü sağla
    document.getElementById('questionScreen').classList.add('hidden');
    document.getElementById('resultScreen').classList.remove('hidden');
});

// Çark Animasyonu ve Sonucu
socket.on('wheelResult', (data) => {
    wheelOverlay.classList.remove('hidden');
    const winnerDisplay = document.getElementById('winnerDisplay');
    
    // Animasyon
    let count = 0;
    const candidates = data.candidates && data.candidates.length > 0 ? data.candidates : ["???"];
    const isAnon = (data.anonymityMode === 'full');

    const interval = setInterval(() => {
        let displayText = candidates[Math.floor(Math.random() * candidates.length)];
        if (isAnon) displayText = "???";
        
        winnerDisplay.innerText = displayText;
        count++;
        if (count > 20) {
            clearInterval(interval);
            winnerDisplay.innerText = data.winnerName;
            
            // Eğer kazanan ben isem
            // Not: Server artık winnerId olarak persistentId gönderiyor olabilir. 
            // Ancak client tarafında socket.id mi yoksa persistentId mi kullanıyoruz?
            // PlayerJoin'de persistentId'yi sakladık.
            if (data.winnerId === myPersistentId || data.winnerId === socket.id) { // Her ihtimale karşı ikisini de kontrol edelim (socket.id fallback)
                isMyTurnToPick = true;
                document.getElementById('selectionModeMessage').classList.remove('hidden');
                setTimeout(() => {
                    wheelOverlay.classList.add('hidden'); // Çarkı kapat, seçim ekranına dön
                    alert("Tebrikler! Merak ettiğin bir cevabın üzerine tıkla.");
                }, 3000);
            } else {
                setTimeout(() => {
                    wheelOverlay.classList.add('hidden');
                }, 3000);
            }
        }
    }, 100);
});

function pickAnswer(answerText) {
    if (!isMyTurnToPick) return;
    
    showConfirm('Cevap Seçimi', `"${answerText}" cevabının sahibini görmek istiyor musun?`, () => {
        socket.emit('revealAuthor', answerText);
        isMyTurnToPick = false; // Hakkını kullandı
        document.getElementById('selectionModeMessage').classList.add('hidden');
    });
}

socket.on('authorRevealed', (data) => {
    // Herkesin ekranında yazarı göster
    const container = document.getElementById('publicAnswers');
    const cards = document.querySelectorAll('.answer-card');
    let found = false;

    cards.forEach(card => {
        // Not: card.innerText içinde yazar adı da olabilir, bu yüzden sadece answer'a bakmak riskli olabilir ama
        // şimdilik basit match yapıyoruz. Daha sağlamı: data-answer attribute kullanmak.
        // Ama şimdilik includes ile devam edelim, ancak yazar eklenmemişse ekleyelim.
        
        // İçeriği temizlemeden eklemek için:
        if (card.innerText.includes(data.answer) && !card.innerText.includes("(Yazan:")) {
            card.style.border = "2px solid var(--accent-color)";
            card.innerHTML += `<br><span style="color: var(--accent-color); font-weight:bold;">(Yazan: ${data.author})</span>`;
            found = true;
        } else if (card.innerText.includes(data.answer)) {
            // Zaten yazılmışsa found true yap
            found = true;
        }
    });

    // Eğer "admin_only" modundaysak ve kartlar görünmüyorsa (yani kilitli ekran varsa)
    // Yine de bu ifşayı göstermemiz gerekir.
    if (!found) {
        // Mevcut kilitli ekranın altına ekleyelim
        const revealedCard = document.createElement('div');
        revealedCard.className = 'answer-card';
        revealedCard.style.border = "2px solid var(--accent-color)";
        revealedCard.innerHTML = `${data.answer} <br><span style="color: var(--accent-color); font-weight:bold;">(Yazan: ${data.author})</span>`;
        
        // Eğer container'da sadece loader/kilit mesajı varsa, altına ekle
        container.appendChild(revealedCard);
    }
});

socket.on('gameOver', () => {
    questionScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    gameOverScreen.classList.remove('hidden');
});
