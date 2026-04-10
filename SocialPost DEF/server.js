// Importa i moduli necessari
const express = require("express"); // Framework per creare il server web
const fs      = require("fs");      // Modulo per lavorare con i file
const path    = require("path");    // Modulo per gestire i percorsi dei file
const http    = require("http");    // Modulo HTTP per WebSocket
const WebSocket = require("ws");    // Modulo WebSocket

// Crea un'applicazione Express
const app    = express();
// Crea un server HTTP dall'app Express
const server = http.createServer(app);
// Crea un server WebSocket sul server HTTP
const wss    = new WebSocket.Server({ server });

// Imposta la porta su cui il server ascolterà
const PORT = 3000;

// Configura Express per servire file statici dalla cartella 'public'
app.use(express.static("public"));
// Abilita il parsing dei dati inviati dai form HTML
// Il limite è alzato a 10 MB per supportare le immagini in formato base64
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Abilita il parsing JSON con limite aumentato per immagini base64
app.use(express.json({ limit: '10mb' }));
// Imposta EJS come motore di template per le viste
app.set("view engine", "ejs");

// Definisce i percorsi dei file JSON per utenti e post
const usersFile = path.join(__dirname, "utenti.json");
const postsFile = path.join(__dirname, "posts.json");

// ─── MAPPA UTENTI ONLINE (WebSocket) ────────────────────────────────────────
// Tiene traccia di tutte le connessioni WebSocket attive: ws → username
const onlineUsers = new Map();

// ─── MIDDLEWARE COOKIE ───────────────────────────────────────────────────────
// Middleware per gestire i cookie dell'utente
app.use((req, res, next) => {
    if (req.headers.cookie) {
        // Se ci sono cookie, li dividiamo in un array
        const cookies    = req.headers.cookie.split('; ');
        // Cerchiamo il cookie dell'utente
        const userCookie = cookies.find(c => c.startsWith('user='));
        // Decodifichiamo l'username dall'URL e lo salviamo in res.locals
        res.locals.currentUser = userCookie
            ? decodeURIComponent(userCookie.split('=')[1])
            : null;
    } else {
        // Se non ci sono cookie, l'utente non è loggato
        res.locals.currentUser = null;
    }
    next(); // Passa alla prossima funzione middleware
});

// ─── HELPER JSON ─────────────────────────────────────────────────────────────

// Funzione helper per leggere file JSON con gestione errori
function readJSONFile(filePath, defaultData = []) {
    try {
        if (!fs.existsSync(filePath)) return defaultData;
        const data = fs.readFileSync(filePath, 'utf8');
        if (!data.trim()) return defaultData;
        return JSON.parse(data);
    } catch (error) {
        console.error(`Errore nella lettura del file ${filePath}:`, error);
        return defaultData;
    }
}

// Funzione helper per scrivere file JSON
function writeJSONFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Errore nella scrittura del file ${filePath}:`, error);
        return false;
    }
}

// ─── HELPER BROADCAST CONTATORE ONLINE ───────────────────────────────────────
// Invia a tutti i client WebSocket il numero corrente di utenti online
function broadcastOnlineCount() {
    const count = onlineUsers.size;
    const payload = JSON.stringify({ type: 'online_count', count });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

// ─── ROUTE HOME ───────────────────────────────────────────────────────────────
// Route per la home page
app.get("/", (req, res) => {
    try {
        // Legge i post dal file JSON
        const posts = readJSONFile(postsFile, []);
        // Renderizza la pagina index.ejs passando i post e l'utente corrente
        res.render("index", { posts, currentUser: res.locals.currentUser });
    } catch (error) {
        console.error("Errore nel caricamento dei post:", error);
        res.render("index", { posts: [], currentUser: res.locals.currentUser });
    }
});

// ─── ROUTE LOGIN ──────────────────────────────────────────────────────────────

// Route per la pagina di login (GET)
app.get("/login",  (req, res) => res.render("login",  { error: null }));

// Route per il form di login (POST)
app.post("/login", (req, res) => {
    // Prende username e password dal form
    const { username, password } = req.body;
    try {
        // Legge il file degli utenti
        const users = readJSONFile(usersFile, []);
        // Cerca l'utente con username e password corrispondenti
        const user  = users.find(u => u.username === username && u.password === password);
        if (user) {
            // Se trovato, imposta il cookie e reindirizza alla home
            res.setHeader('Set-Cookie', `user=${encodeURIComponent(username)}; Path=/`);
            return res.redirect("/");
        }
        // Se non trovato, mostra errore
        res.render("login", { error: "Credenziali errate" });
    } catch (error) {
        console.error("Errore nel login:", error);
        res.render("login", { error: "Errore nel server. Riprova." });
    }
});

// ─── ROUTE SIGNUP ─────────────────────────────────────────────────────────────

// Route per la pagina di registrazione (GET)
app.get("/signup",  (req, res) => res.render("signup",  { error: null }));

// Route per il form di registrazione (POST)
app.post("/signup", (req, res) => {
    const { username, password } = req.body;
    try {
        // Legge gli utenti esistenti
        const users = readJSONFile(usersFile, []);
        // Controlla se l'username è già in uso
        if (users.some(u => u.username === username)) {
            return res.render("signup", { error: "Username già in uso" });
        }
        // Aggiunge il nuovo utente
        users.push({ username, password });
        // Salva il file aggiornato
        if (writeJSONFile(usersFile, users)) {
            // Imposta il cookie e reindirizza alla home
            res.setHeader('Set-Cookie', `user=${encodeURIComponent(username)}; Path=/`);
            return res.redirect("/");
        } else {
            return res.render("signup", { error: "Errore nella registrazione" });
        }
    } catch (error) {
        console.error("Errore nella registrazione:", error);
        res.render("signup", { error: "Errore nel server. Riprova." });
    }
});

// ─── ROUTE LOGOUT ─────────────────────────────────────────────────────────────

// Route per il logout
app.get("/logout", (req, res) => {
    // Cancella il cookie impostando una data di scadenza passata
    res.setHeader('Set-Cookie', 'user=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    res.redirect("/");
});

// ─── ROUTE POST ───────────────────────────────────────────────────────────────

// Route per la pagina di creazione post (GET)
app.get("/post", (req, res) => {
    // Se l'utente non è loggato, reindirizza al login
    if (!res.locals.currentUser) return res.redirect("/login");
    res.render("post", { error: null, currentUser: res.locals.currentUser });
});

// Route per il form di creazione post (POST)
app.post("/post", (req, res) => {
    if (!res.locals.currentUser) return res.redirect("/login");

    // Prende titolo, contenuto, immagine e tag dal form
    const { title, content, image, tags } = req.body;

    try {
        // Legge i post esistenti
        const posts = readJSONFile(postsFile, []);

        // Costruisce l'oggetto post con tutti i campi
        // Il campo 'image' contiene una stringa base64 (data URL) inviata dal client
        // Il campo 'tags' contiene i tag separati da virgola
        const newPost = {
            title,
            content,
            author: res.locals.currentUser,   // Utente corrente
            date:   new Date().toLocaleString(), // Data corrente
            likes:  [],                          // Array di username che hanno messo like
            tags:   tags
                ? tags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean)
                : []                             // Array di tag (senza il carattere #)
        };

        // Aggiunge l'immagine solo se presente e non vuota
        if (image && image.length > 0 && image.startsWith('data:')) {
            newPost.image = image; // Stringa data URL (base64)
        }

        // Aggiunge il post all'array
        posts.push(newPost);

        // Salva i post aggiornati
        if (writeJSONFile(postsFile, posts)) {
            res.redirect("/");
        } else {
            res.render("post", { error: "Errore nel salvataggio del post", currentUser: res.locals.currentUser });
        }
    } catch (error) {
        console.error("Errore nella creazione del post:", error);
        res.render("post", { error: "Errore nel server. Riprova.", currentUser: res.locals.currentUser });
    }
});

// ─── ROUTE LIKE ───────────────────────────────────────────────────────────────

// Route per mettere/togliere like a un post (POST, risponde in JSON)
// Riceve l'indice del post come campo 'postIndex' nel body
// Risponde con { likes: <numero totale>, liked: <boolean> }
app.post("/like", (req, res) => {
    // Solo utenti autenticati possono mettere like
    if (!res.locals.currentUser) {
        return res.json({ error: 'Non autorizzato' });
    }

    const { postIndex } = req.body;
    const posts = readJSONFile(postsFile, []);
    const idx   = parseInt(postIndex, 10);

    // Verifica che l'indice sia valido
    if (isNaN(idx) || idx < 0 || idx >= posts.length) {
        return res.json({ error: 'Post non trovato' });
    }

    // Inizializza l'array likes se non esiste
    if (!posts[idx].likes) posts[idx].likes = [];

    const user    = res.locals.currentUser;
    const likePos = posts[idx].likes.indexOf(user);

    if (likePos === -1) {
        // L'utente non aveva ancora messo like → aggiunge
        posts[idx].likes.push(user);
    } else {
        // L'utente aveva già messo like → toglie (toggle)
        posts[idx].likes.splice(likePos, 1);
    }

    writeJSONFile(postsFile, posts);

    // Risponde con il nuovo conteggio e lo stato del like
    res.json({
        likes: posts[idx].likes.length,
        liked: likePos === -1   // true = appena aggiunto, false = appena rimosso
    });
});

// ─── ROUTE CHAT ───────────────────────────────────────────────────────────────

// Route per la pagina chat
app.get("/chat", (req, res) => {
    // Se l'utente non è loggato, reindirizza al login
    if (!res.locals.currentUser) return res.redirect("/login");
    res.render("chat", { currentUser: res.locals.currentUser });
});

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────

// Gestione connessioni WebSocket
wss.on('connection', (ws, req) => {
    console.log('Nuova connessione WebSocket');

    // Estrai il nome utente dai cookie della richiesta di handshake
    let username = "Anonimo";
    if (req.headers.cookie) {
        const cookies    = req.headers.cookie.split('; ');
        const userCookie = cookies.find(c => c.startsWith('user='));
        if (userCookie) username = decodeURIComponent(userCookie.split('=')[1]);
    }

    // Registra l'utente nella mappa degli utenti online
    onlineUsers.set(ws, username);

    // Invia messaggio di benvenuto all'utente appena connesso
    ws.send(JSON.stringify({
        type:      'system',
        message:   `Benvenuto nella chat, ${username}!`,
        timestamp: new Date().toISOString()
    }));

    // Notifica a tutti gli altri utenti dell'ingresso
    wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type:      'system',
                message:   `${username} si è unito alla chat`,
                timestamp: new Date().toISOString()
            }));
        }
    });

    // Aggiorna il contatore utenti online per tutti
    broadcastOnlineCount();

    // ── GESTIONE MESSAGGI IN ARRIVO ──────────────────────────────────────────
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'chat') {
                // Messaggio di chat normale: lo invia a tutti i client connessi
                const chatMessage = {
                    type:      'chat',
                    username:  username,
                    message:   data.message,
                    timestamp: new Date().toISOString()
                };
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(chatMessage));
                    }
                });

            } else if (data.type === 'typing') {
                // Indicatore di digitazione: inviato agli altri quando l'utente sta scrivendo
                // Non viene loggato o salvato, è solo un segnale real-time
                wss.clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type:     'typing',
                            username: username
                        }));
                    }
                });

            } else if (data.type === 'stop_typing') {
                // Segnale di stop digitazione: inviato agli altri quando l'utente smette
                wss.clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type:     'stop_typing',
                            username: username
                        }));
                    }
                });
            }

        } catch (error) {
            console.error('Errore nel parsing del messaggio:', error);
        }
    });

    // ── GESTIONE CHIUSURA CONNESSIONE ────────────────────────────────────────
    ws.on('close', () => {
        console.log(`${username} ha lasciato la chat`);

        // Rimuove l'utente dalla mappa
        onlineUsers.delete(ws);

        // Notifica a tutti gli altri utenti dell'uscita
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type:      'system',
                    message:   `${username} ha lasciato la chat`,
                    timestamp: new Date().toISOString()
                }));
            }
        });

        // Aggiorna il contatore utenti online per tutti
        broadcastOnlineCount();
    });

    // Gestione errori WebSocket
    ws.on('error', (error) => {
        console.error('Errore WebSocket:', error);
    });
});

// ─── AVVIO SERVER ─────────────────────────────────────────────────────────────

// Avvia il server HTTP (usa server.listen invece di app.listen per supportare WebSocket)
server.listen(PORT, () => console.log(`Server avviato su http://localhost:${PORT}`));
