/*
 * SOCIAL POSTIT – SERVER PRINCIPALE
 * =============================================================================
 * Questo file avvia un server HTTP + WebSocket che gestisce:
 * - autenticazione (cookie)
 * - pubblicazione di post con immagini (base64)
 * - like, commenti, eliminazione commenti
 * - profili utente, follow/unfollow, segnalibri
 * - ricerca di post e utenti
 * - chat in tempo reale con WebSocket
 * 
 * I dati vengono salvati in due file JSON: `utenti.json` e `posts.json`.
 * Non viene utilizzato alcun database esterno.
 */

// ---------------------------- IMPORTAZIONE MODULI ----------------------------
const express = require("express");      // Framework web per routing e middleware
const fs      = require("fs");           // Modulo nativo per leggere/scrivere file
const path    = require("path");         // Gestione percorsi cross‑platform
const http    = require("http");         // Server HTTP base (necessario per WebSocket)
const WebSocket = require("ws");         // Libreria WebSocket per la chat in tempo reale

// ---------------------------- INIZIALIZZAZIONE APP ----------------------------
const app    = express();                // Istanza principale di Express
const server = http.createServer(app);   // Server HTTP creato manualmente (per condivisione porta)
const wss    = new WebSocket.Server({ server }); // Server WebSocket agganciato allo stesso server HTTP

const PORT = 3000;                       // Porta su cui il server sarà in ascolto

// ---------------------------- CONFIGURAZIONE EXPRESS ----------------------------
// Servire file statici dalla cartella 'public' (es. background.gif, CSS extra)
app.use(express.static("public"));

// Middleware per decodificare i dati inviati da form HTML (application/x-www-form-urlencoded)
// Il limite di 10 MB è necessario per supportare immagini in base64.
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware per decodificare JSON nel body (usato dalle richieste AJAX come i like)
app.use(express.json({ limit: '10mb' }));

// Imposta EJS come motore di template (i file .ejs devono essere nella cartella 'views')
app.set("view engine", "ejs");

// ---------------------------- PERCORSI DEI FILE JSON ----------------------------
// path.join garantisce percorsi corretti su Windows, macOS, Linux
const usersFile = path.join(__dirname, "utenti.json");
const postsFile = path.join(__dirname, "posts.json");

// ---------------------------- MAPPA UTENTI ONLINE (WEBSOCKET) --------------------
// Tiene traccia di chi è connesso alla chat: chiave = oggetto WebSocket, valore = username
const onlineUsers = new Map();

// ---------------------------- HELPER PER LA LETTURA/SCRITTURA JSON ---------------
/**
 * Legge un file JSON e restituisce il suo contenuto come oggetto JavaScript.
 * Se il file non esiste o è vuoto, restituisce `defaultData` (default: array vuoto).
 * Gestisce eventuali errori di parsing.
 */
function readJSONFile(filePath, defaultData = []) {
    try {
        if (!fs.existsSync(filePath)) return defaultData;          // File inesistente → default
        const data = fs.readFileSync(filePath, 'utf8');           // Legge il file come stringa
        if (!data.trim()) return defaultData;                     // File vuoto → default
        return JSON.parse(data);                                  // Converte la stringa JSON in oggetto
    } catch (error) {
        console.error(`Errore nella lettura del file ${filePath}:`, error);
        return defaultData;
    }
}

/**
 * Scrive un oggetto JavaScript su file JSON con indentazione di 2 spazi.
 * Restituisce `true` in caso di successo, `false` in caso di errore.
 */
function writeJSONFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Errore nella scrittura del file ${filePath}:`, error);
        return false;
    }
}

// ---------------------------- HELPER PER I COOKIE --------------------------------
/**
 * Estrae lo username dal cookie di sessione presente nell'header HTTP.
 * Formato atteso: "user=username; ..."
 * Restituisce `null` se il cookie non esiste o non è valido.
 */
function getUserFromCookies(cookieHeader) {
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split('; ');
    const userCookie = cookies.find(c => c.startsWith('user='));
    return userCookie ? decodeURIComponent(userCookie.split('=')[1]) : null;
}

// ---------------------------- HELPER WEBSOCKET (BROADCAST) -----------------------
/**
 * Invia il conteggio degli utenti online a tutti i client connessi via WebSocket.
 */
function broadcastOnlineCount() {
    const count = onlineUsers.size;
    const payload = JSON.stringify({ type: 'online_count', count });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

/**
 * Invia un messaggio a tutti i client WebSocket connessi, con possibilità di escluderne uno.
 * @param {WebSocket.Server} wss   - Il server WebSocket
 * @param {Object} payload         - Oggetto da serializzare in JSON
 * @param {WebSocket} exclude      - Client da escludere (opzionale)
 */
function broadcast(wss, payload, exclude = null) {
    const msg = JSON.stringify(payload);
    wss.clients.forEach(client => {
        if (client !== exclude && client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}

// ---------------------------- MIDDLEWARE DI AUTENTICAZIONE -----------------------
// Questo middleware viene eseguito per OGNI richiesta HTTP.
// Legge il cookie e imposta `res.locals.currentUser` (accessibile nei template EJS).
app.use((req, res, next) => {
    res.locals.currentUser = getUserFromCookies(req.headers.cookie);
    next(); // Passa al middleware o alla route successiva
});

// ---------------------------- ROUTE HTTP -----------------------------------------

// ---------------------------------------------------------------------------------
// HOME PAGE
// ---------------------------------------------------------------------------------
app.get("/", (req, res) => {
    const posts = readJSONFile(postsFile, []);   // Carica tutti i post
    // Renderizza il template `index.ejs` passando i post e l'utente corrente
    res.render("index", { posts, currentUser: res.locals.currentUser });
});

// ---------------------------------------------------------------------------------
// LOGIN (GET e POST)
// ---------------------------------------------------------------------------------
app.get("/login", (req, res) => {
    // Mostra la pagina di login senza messaggi di errore
    res.render("login", { error: null });
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const users = readJSONFile(usersFile, []);
    // Cerca un utente con username e password corrispondenti
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) {
        // Credenziali errate: re‑renderizza il form con messaggio di errore
        return res.render("login", { error: "Credenziali errate" });
    }
    // Imposta il cookie di sessione (HttpOnly per sicurezza, SameSite=Lax)
    res.setHeader('Set-Cookie', `user=${encodeURIComponent(username)}; Path=/; HttpOnly; SameSite=Lax`);
    res.redirect("/");
});

// ---------------------------------------------------------------------------------
// SIGNUP (GET e POST)
// ---------------------------------------------------------------------------------
app.get("/signup", (req, res) => {
    res.render("signup", { error: null });
});

app.post("/signup", (req, res) => {
    const { username, password } = req.body;
    const users = readJSONFile(usersFile, []);
    // Verifica che lo username non sia già utilizzato
    if (users.some(u => u.username === username)) {
        return res.render("signup", { error: "Username già in uso" });
    }
    // Crea un nuovo utente con struttura completa (bio, followers, etc.)
    users.push({
        username,
        password,
        bio: "",
        followers: [],
        following: [],
        avatar: username.charAt(0).toUpperCase(),
        bookmarks: [],
        createdAt: new Date().toISOString()
    });
    if (!writeJSONFile(usersFile, users)) {
        return res.render("signup", { error: "Errore nella registrazione" });
    }
    // Auto‑login: imposta il cookie e reindirizza alla home
    res.setHeader('Set-Cookie', `user=${encodeURIComponent(username)}; Path=/; HttpOnly; SameSite=Lax`);
    res.redirect("/");
});

// ---------------------------------------------------------------------------------
// LOGOUT
// ---------------------------------------------------------------------------------
app.get("/logout", (req, res) => {
    // Cancella il cookie impostando una data di scadenza nel passato
    res.setHeader('Set-Cookie', 'user=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax');
    res.redirect("/");
});

// ---------------------------------------------------------------------------------
// CREAZIONE POST (GET e POST)
// ---------------------------------------------------------------------------------
app.get("/post", (req, res) => {
    // Solo utenti autenticati possono accedere alla pagina di creazione post
    if (!res.locals.currentUser) return res.redirect("/login");
    res.render("post", { error: null, currentUser: res.locals.currentUser });
});

app.post("/post", (req, res) => {
    if (!res.locals.currentUser) return res.redirect("/login");
    const { title, content, image, tags } = req.body;
    const posts = readJSONFile(postsFile, []);
    // Costruisce l'oggetto post
    const newPost = {
        title,
        content,
        author: res.locals.currentUser,
        date: new Date().toLocaleString(),
        likes: [],
        comments: [],
        tags: tags ? tags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean) : []
    };
    // Se è stata caricata un'immagine valida, la include come stringa base64
    if (image && image.length > 0 && image.startsWith('data:')) {
        newPost.image = image;
    }
    posts.push(newPost);
    if (!writeJSONFile(postsFile, posts)) {
        return res.render("post", { error: "Errore nel salvataggio del post", currentUser: res.locals.currentUser });
    }
    res.redirect("/");
});

// ---------------------------------------------------------------------------------
// LIKE (AJAX)
// ---------------------------------------------------------------------------------
app.post("/like", (req, res) => {
    if (!res.locals.currentUser) return res.json({ error: 'Non autorizzato' });
    const { postIndex } = req.body;
    const posts = readJSONFile(postsFile, []);
    const idx = parseInt(postIndex, 10);
    // Verifica che l'indice sia valido
    if (isNaN(idx) || idx < 0 || idx >= posts.length) return res.json({ error: 'Post non trovato' });
    if (!posts[idx].likes) posts[idx].likes = [];
    const user = res.locals.currentUser;
    const likePos = posts[idx].likes.indexOf(user);
    const liked = likePos === -1;
    if (liked) {
        posts[idx].likes.push(user);      // Aggiunge il like
    } else {
        posts[idx].likes.splice(likePos, 1); // Rimuove il like (toggle)
    }
    writeJSONFile(postsFile, posts);
    // Risponde con il nuovo conteggio e lo stato del like per aggiornare l'interfaccia
    res.json({ likes: posts[idx].likes.length, liked });
});

// ---------------------------------------------------------------------------------
// COMMENTI
// ---------------------------------------------------------------------------------
app.post("/comment/:postIndex", (req, res) => {
    if (!res.locals.currentUser) return res.redirect("/login");
    const { text } = req.body;
    if (!text || !text.trim()) return res.redirect("/");
    const postIndex = parseInt(req.params.postIndex, 10);
    const posts = readJSONFile(postsFile, []);
    if (isNaN(postIndex) || postIndex < 0 || postIndex >= posts.length) return res.redirect("/");
    if (!posts[postIndex].comments) posts[postIndex].comments = [];
    // Aggiunge il commento con autore (dal cookie) e data corrente
    posts[postIndex].comments.push({
        author: res.locals.currentUser,
        text: text.trim(),
        date: new Date().toLocaleString()
    });
    writeJSONFile(postsFile, posts);
    res.redirect("/");
});

// Eliminazione commento (solo autore)
app.post("/delete-comment/:postIndex/:commentIndex", (req, res) => {
    if (!res.locals.currentUser) return res.json({ error: 'Non autorizzato' });
    const postIndex = parseInt(req.params.postIndex, 10);
    const commentIndex = parseInt(req.params.commentIndex, 10);
    const posts = readJSONFile(postsFile, []);
    if (isNaN(postIndex) || postIndex < 0 || postIndex >= posts.length ||
        isNaN(commentIndex) || commentIndex < 0) {
        return res.json({ error: 'Post o commento non trovato' });
    }
    const post = posts[postIndex];
    if (!post.comments || commentIndex >= post.comments.length) {
        return res.json({ error: 'Commento non trovato' });
    }
    // Solo l'autore del commento può eliminarlo
    if (post.comments[commentIndex].author !== res.locals.currentUser) {
        return res.json({ error: 'Non puoi cancellare commenti di altri utenti' });
    }
    post.comments.splice(commentIndex, 1);
    writeJSONFile(postsFile, posts);
    res.json({ success: true });
});

// ---------------------------------------------------------------------------------
// PROFILO UTENTE
// ---------------------------------------------------------------------------------
app.get("/profile/:username", (req, res) => {
    const targetUsername = req.params.username;
    const users = readJSONFile(usersFile, []);
    const targetUser = users.find(u => u.username === targetUsername);
    if (!targetUser) return res.status(404).render("404", { message: "Utente non trovato" });
    const posts = readJSONFile(postsFile, []);
    // Filtra solo i post dell'utente e li ordina dal più recente
    const userPosts = posts
        .map((p, i) => ({ ...p, index: i }))
        .filter(p => p.author === targetUsername)
        .reverse();
    // Controlla se l'utente loggato segue questo profilo
    const isFollowing = res.locals.currentUser && targetUser.followers.includes(res.locals.currentUser);
    res.render("profile", {
        targetUser,
        userPosts,
        isFollowing,
        currentUser: res.locals.currentUser
    });
});

// Redirect al proprio profilo
app.get("/profile", (req, res) => {
    if (!res.locals.currentUser) return res.redirect("/login");
    res.redirect(`/profile/${res.locals.currentUser}`);
});

// ---------------------------------------------------------------------------------
// FOLLOW / UNFOLLOW
// ---------------------------------------------------------------------------------
app.post("/follow/:username", (req, res) => {
    if (!res.locals.currentUser) return res.json({ error: 'Non autorizzato' });
    const targetUsername = req.params.username;
    if (targetUsername === res.locals.currentUser) return res.json({ error: 'Non puoi seguire te stesso' });
    const users = readJSONFile(usersFile, []);
    const currentUserObj = users.find(u => u.username === res.locals.currentUser);
    const targetUser = users.find(u => u.username === targetUsername);
    if (!currentUserObj || !targetUser) return res.json({ error: 'Utente non trovato' });
    // Inizializza array se necessario
    if (!currentUserObj.following) currentUserObj.following = [];
    if (!targetUser.followers) targetUser.followers = [];
    const isFollowing = currentUserObj.following.includes(targetUsername);
    if (isFollowing) {
        // Unfollow
        currentUserObj.following = currentUserObj.following.filter(u => u !== targetUsername);
        targetUser.followers = targetUser.followers.filter(u => u !== res.locals.currentUser);
    } else {
        // Follow
        currentUserObj.following.push(targetUsername);
        targetUser.followers.push(res.locals.currentUser);
    }
    writeJSONFile(usersFile, users);
    res.json({ success: true, isFollowing: !isFollowing });
});

// ---------------------------------------------------------------------------------
// RICERCA
// ---------------------------------------------------------------------------------
app.get("/search", (req, res) => {
    const q = (req.query.q || '').toLowerCase().trim();
    const users = readJSONFile(usersFile, []);
    const posts = readJSONFile(postsFile, []);
    let searchResults = { users: [], posts: [] };
    if (q.length > 0) {
        // Ricerca tra gli utenti (username)
        searchResults.users = users
            .filter(u => u.username.toLowerCase().includes(q))
            .map(u => ({
                username: u.username,
                avatar: u.avatar || u.username.charAt(0).toUpperCase(),
                bio: u.bio || '',
                followers: u.followers ? u.followers.length : 0,
                following: u.following ? u.following.length : 0
            }));
        // Ricerca tra i post (titolo, contenuto, autore, tag)
        searchResults.posts = posts
            .map((p, i) => ({ ...p, index: i }))
            .filter(p =>
                p.title.toLowerCase().includes(q) ||
                p.content.toLowerCase().includes(q) ||
                p.author.toLowerCase().includes(q) ||
                (p.tags && p.tags.some(t => t.toLowerCase().includes(q)))
            )
            .reverse()
            .slice(0, 20); // Limita a 20 risultati
    }
    res.render("search", {
        query: q,
        results: searchResults,
        currentUser: res.locals.currentUser
    });
});

// API per suggerimenti di ricerca (autocomplete)
app.get("/api/search", (req, res) => {
    const q = (req.query.q || '').toLowerCase().trim();
    if (q.length < 2) return res.json({ users: [], posts: [] });
    const users = readJSONFile(usersFile, []);
    const posts = readJSONFile(postsFile, []);
    const searchResults = {
        users: users
            .filter(u => u.username.toLowerCase().includes(q))
            .slice(0, 5)
            .map(u => ({
                username: u.username,
                avatar: u.avatar || u.username.charAt(0).toUpperCase()
            })),
        posts: posts
            .map((p, i) => ({ ...p, index: i }))
            .filter(p => p.title.toLowerCase().includes(q) || p.author.toLowerCase().includes(q))
            .slice(0, 5)
            .map(p => ({
                title: p.title,
                author: p.author,
                index: p.index
            }))
    };
    res.json(searchResults);
});

// ---------------------------------------------------------------------------------
// SEGNALIBRI
// ---------------------------------------------------------------------------------
app.post("/bookmark/:postIndex", (req, res) => {
    if (!res.locals.currentUser) return res.json({ error: 'Non autorizzato' });
    const postIndex = parseInt(req.params.postIndex, 10);
    const users = readJSONFile(usersFile, []);
    const posts = readJSONFile(postsFile, []);
    if (isNaN(postIndex) || postIndex < 0 || postIndex >= posts.length) {
        return res.json({ error: 'Post non trovato' });
    }
    const user = users.find(u => u.username === res.locals.currentUser);
    if (!user) return res.json({ error: 'Utente non trovato' });
    if (!user.bookmarks) user.bookmarks = [];
    const bookmarkIndex = user.bookmarks.indexOf(postIndex);
    const isBookmarked = bookmarkIndex !== -1;
    if (isBookmarked) {
        user.bookmarks.splice(bookmarkIndex, 1);   // Rimuovi segnalibro
    } else {
        user.bookmarks.push(postIndex);            // Aggiungi segnalibro
    }
    writeJSONFile(usersFile, users);
    res.json({ success: true, isBookmarked: !isBookmarked });
});

app.get("/bookmarks", (req, res) => {
    if (!res.locals.currentUser) return res.redirect("/login");
    const users = readJSONFile(usersFile, []);
    const posts = readJSONFile(postsFile, []);
    const user = users.find(u => u.username === res.locals.currentUser);
    if (!user) return res.render("bookmarks", { bookmarkedPosts: [], currentUser: res.locals.currentUser });
    const bookmarks = user.bookmarks || [];
    // Recupera i post salvati (ignora quelli eventualmente cancellati)
    const bookmarkedPosts = bookmarks
        .map(idx => ({ ...posts[idx], index: idx }))
        .filter(p => p && p.title)
        .reverse();
    res.render("bookmarks", { bookmarkedPosts, currentUser: res.locals.currentUser });
});

// ---------------------------------------------------------------------------------
// CHAT
// ---------------------------------------------------------------------------------
app.get("/chat", (req, res) => {
    if (!res.locals.currentUser) return res.redirect("/login");
    res.render("chat", { currentUser: res.locals.currentUser });
});

// ---------------------------------------------------------------------------------
// 404 - Pagina non trovata
// ---------------------------------------------------------------------------------
app.use((req, res) => {
    res.status(404).render("404", { message: "Pagina non trovata" });
});

// ---------------------------- WEBSOCKET (CHAT) ----------------------------------
wss.on('connection', (ws, req) => {
    // Estrae lo username dal cookie della richiesta di handshake WebSocket
    let username = getUserFromCookies(req.headers.cookie) || "Anonimo";
    onlineUsers.set(ws, username);

    // Messaggio di benvenuto privato al nuovo utente
    ws.send(JSON.stringify({
        type: 'system',
        message: `Benvenuto nella chat, ${username}!`,
        timestamp: new Date().toISOString()
    }));

    // Notifica a tutti gli altri utenti dell'ingresso
    broadcast(wss, {
        type: 'system',
        message: `${username} si è unito alla chat`,
        timestamp: new Date().toISOString()
    }, ws);

    // Aggiorna il contatore di utenti online per tutti
    broadcastOnlineCount();

    // Gestione dei messaggi in arrivo da questo client
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'chat') {
                // Messaggio di chat normale: broadcast a tutti
                broadcast(wss, {
                    type: 'chat',
                    username: username,
                    message: data.message,
                    timestamp: new Date().toISOString()
                });
            } else if (data.type === 'typing') {
                // Indicatore di digitazione: inviato a tutti tranne al mittente
                broadcast(wss, { type: 'typing', username }, ws);
            } else if (data.type === 'stop_typing') {
                // Stop digitazione: inviato a tutti tranne al mittente
                broadcast(wss, { type: 'stop_typing', username }, ws);
            }
        } catch (error) {
            console.error('Errore parsing messaggio WebSocket:', error);
        }
    });

    // Gestione chiusura connessione
    ws.on('close', () => {
        onlineUsers.delete(ws);
        broadcast(wss, {
            type: 'system',
            message: `${username} ha lasciato la chat`,
            timestamp: new Date().toISOString()
        });
        broadcastOnlineCount();
    });

    ws.on('error', (error) => console.error('Errore WebSocket:', error));
});

// ---------------------------- AVVIO DEL SERVER ---------------------------------
server.listen(PORT, () => {
    console.log(`🚀 Server avviato su http://localhost:${PORT}`);
});