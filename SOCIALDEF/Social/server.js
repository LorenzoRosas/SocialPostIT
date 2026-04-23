// ═════════════════════════════════════════════════════════════════════════════
// SERVER.JS - SERVER PRINCIPALE PER SOCIAL POSTIT
// Framework: Express.js con WebSocket (ws)
// Database: JSON file (utenti.json, posts.json)
// ═════════════════════════════════════════════════════════════════════════════

/* ─────────────────────────────────────────────────────────────────────────
   IMPORT MODULI NECESSARI
   ───────────────────────────────────────────────────────────────────────── */

// Importa Express - framework web per gestire route e middleware
const express   = require("express");
// Importa fs - modulo nativo Node per leggere/scrivere file
const fs        = require("fs");
// Importa path - modulo nativo Node per gestire i percorsi dei file
const path      = require("path");
// Importa http - modulo nativo Node per creare il server HTTP base
const http      = require("http");
// Importa WebSocket - libreria per la comunicazione real-time
const WebSocket = require("ws");

/* ─────────────────────────────────────────────────────────────────────────
   SETUP SERVER
   ───────────────────────────────────────────────────────────────────────── */

// Crea l'applicazione Express
const app    = express();
// Crea il server HTTP avvolgendo Express (necessario per condividere la porta con WS)
const server = http.createServer(app);
// Crea il server WebSocket collegato allo stesso server HTTP
const wss    = new WebSocket.Server({ server });

// Porta su cui il server ascolterà (da variabile d'ambiente o default 3000)
const PORT = parseInt(process.env.PORT, 10) || 3000;

/* ─────────────────────────────────────────────────────────────────────────
   CONFIGURAZIONE EXPRESS
   ───────────────────────────────────────────────────────────────────────── */

// Serve i file statici dalla cartella 'public'
app.use(express.static("public"));

// Espone il foglio di stile condiviso dalla root del progetto
app.get("/styles.css", (_req, res) => {
    res.sendFile(path.join(__dirname, "styles.css"));
});

// Abilita il parsing dei form URL-encoded (limite 10MB per immagini base64)
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Abilita il parsing JSON nel body delle richieste (limite 10MB)
app.use(express.json({ limit: '10mb' }));

// Imposta EJS come motore di template per le viste
app.set("view engine", "ejs");

/* ─────────────────────────────────────────────────────────────────────────
   PERCORSI FILE JSON
   ───────────────────────────────────────────────────────────────────────── */

// Percorso assoluto del file JSON degli utenti
const usersFile = path.join(__dirname, "utenti.json");

// Percorso assoluto del file JSON dei post
const postsFile = path.join(__dirname, "posts.json");

/* ─────────────────────────────────────────────────────────────────────────
   MAPPA UTENTI ONLINE (WebSocket)
   Tiene traccia di tutte le connessioni WS attive: ws → username
   ───────────────────────────────────────────────────────────────────────── */

// Map che associa ogni client WebSocket al proprio username
const onlineUsers = new Map();

/* ─────────────────────────────────────────────────────────────────────────
   MIDDLEWARE COOKIE - Legge il cookie di sessione per ogni richiesta HTTP
   ───────────────────────────────────────────────────────────────────────── */

app.use((req, res, next) => {
    // Controlla se ci sono cookie nell'intestazione della richiesta
    if (req.headers.cookie) {
        // Divide la stringa cookie in coppie chiave=valore
        const cookies    = req.headers.cookie.split('; ');
        // Cerca il cookie 'user' che contiene l'username loggato
        const userCookie = cookies.find(c => c.startsWith('user='));
        // Decodifica l'username e lo rende disponibile in tutti i template EJS
        res.locals.currentUser = userCookie
            ? decodeURIComponent(userCookie.split('=')[1])
            : null;
    } else {
        // Nessun cookie presente: nessun utente loggato
        res.locals.currentUser = null;
    }
    // Passa il controllo al middleware successivo
    next();
});

/* ─────────────────────────────────────────────────────────────────────────
   HELPER JSON - Funzioni per leggere/scrivere i file di dati
   ───────────────────────────────────────────────────────────────────────── */

// Legge un file JSON e restituisce l'oggetto JS corrispondente
function readJSONFile(filePath, defaultData = []) {
    try {
        // Se il file non esiste, ritorna i dati di default
        if (!fs.existsSync(filePath)) return defaultData;
        // Legge il contenuto del file come stringa UTF-8
        const data = fs.readFileSync(filePath, 'utf8');
        // Se il file è vuoto, ritorna i dati di default
        if (!data.trim()) return defaultData;
        // Converte la stringa JSON in oggetto JavaScript e ritorna
        return JSON.parse(data);
    } catch (error) {
        // In caso di errore (file corrotto, ecc.), loga e ritorna il default
        console.error(`Errore nella lettura del file ${filePath}:`, error);
        return defaultData;
    }
}

// Scrive un oggetto JavaScript come JSON formattato in un file
function writeJSONFile(filePath, data) {
    try {
        // Converte l'oggetto in stringa JSON con indentazione di 2 spazi
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        // Ritorna true se la scrittura è andata a buon fine
        return true;
    } catch (error) {
        // In caso di errore, loga e ritorna false
        console.error(`Errore nella scrittura del file ${filePath}:`, error);
        return false;
    }
}

/* ─────────────────────────────────────────────────────────────────────────
   HELPER BROADCAST - Invia il contatore online a tutti i client WS
   ───────────────────────────────────────────────────────────────────────── */

function broadcastOnlineCount() {
    // Conta quanti client WS sono attualmente connessi
    const count = onlineUsers.size;
    // Costruisce il payload JSON da inviare
    const payload = JSON.stringify({ type: 'online_count', count });
    // Invia a tutti i client connessi e pronti
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

/* ─────────────────────────────────────────────────────────────────────────
   HELPER DATE - Formatta una data ISO in mese/anno italiano
   ───────────────────────────────────────────────────────────────────────── */

function formatMonthYear(dateString) {
    // Se manca la data, restituisce un testo di fallback
    if (!dateString) return "Data sconosciuta";
    // Converte la stringa in oggetto Date
    const parsedDate = new Date(dateString);
    // Se la data non è valida, ritorna un testo di fallback
    if (Number.isNaN(parsedDate.getTime())) return "Data sconosciuta";
    // Formatta in italiano con mese abbreviato e anno (es. "gen 2024")
    return new Intl.DateTimeFormat("it-IT", {
        month: "short",
        year: "numeric"
    }).format(parsedDate);
}

/* ─────────────────────────────────────────────────────────────────────────
   HELPER RICERCA - Costruisce i risultati per la ricerca e l'autocomplete
   ───────────────────────────────────────────────────────────────────────── */

function buildSearchResults(query) {
    // Normalizza la query: rimuove spazi e converte in minuscolo
    const q = String(query || "").trim().toLowerCase();

    // Se la query è troppo corta, non eseguire la ricerca
    if (q.length < 2) {
        return { users: [], posts: [], results: [], total: 0 };
    }

    // Legge gli utenti e i post dal JSON
    const users = readJSONFile(usersFile, []);
    const posts = readJSONFile(postsFile, []);

    // Costruisce una mappa: username → numero di post pubblicati
    const postCountByAuthor = posts.reduce((accumulator, post) => {
        const author = String(post.author || "").trim();
        if (!author) return accumulator;
        // Incrementa il contatore per questo autore
        accumulator[author] = (accumulator[author] || 0) + 1;
        return accumulator;
    }, {});

    // Filtra e mappa gli utenti che corrispondono alla query
    const matchedUsers = users
        .filter(user => String(user.username || "").toLowerCase().includes(q))
        .slice(0, 8) // Limita a 8 risultati
        .map(user => ({
            username:    user.username,
            name:        user.username,
            avatar:      user.avatar || user.username.charAt(0).toUpperCase(),
            bio:         user.bio || "",
            postCount:   postCountByAuthor[user.username] || 0,
            memberSince: formatMonthYear(user.createdAt)
        }));

    // Filtra e mappa i post che corrispondono alla query
    const matchedPosts = posts
        .map((post, index) => ({ ...post, index })) // Aggiunge l'indice originale
        .filter(post => {
            // Controlla titolo, contenuto, autore e tag
            const title   = String(post.title   || "").toLowerCase();
            const content = String(post.content  || "").toLowerCase();
            const author  = String(post.author   || "").toLowerCase();
            const tags    = Array.isArray(post.tags)
                ? post.tags.join(" ").toLowerCase()
                : "";
            return title.includes(q) || content.includes(q) || author.includes(q) || tags.includes(q);
        })
        .reverse()   // Ordine inverso: più recenti per primi
        .slice(0, 8) // Limita a 8 risultati
        .map(post => ({
            title:        post.title   || "Senza titolo",
            author:       post.author  || "Anonimo",
            index:        post.index,
            excerpt:      String(post.content || "").slice(0, 120),
            date:         post.date    || "",
            likeCount:    Array.isArray(post.likes)    ? post.likes.length    : 0,
            commentCount: Array.isArray(post.comments) ? post.comments.length : 0,
            tags:         Array.isArray(post.tags)     ? post.tags.slice(0, 3): []
        }));

    // Combina utenti e post in un unico array per l'autocomplete
    const mergedResults = [
        ...matchedUsers.map(user => ({
            type:     "user",
            name:     user.username,
            username: user.username,
            avatar:   user.avatar
        })),
        ...matchedPosts.map(post => ({
            type:   "post",
            title:  post.title,
            author: post.author,
            index:  post.index
        }))
    ].slice(0, 8); // Limita il totale a 8

    // Ritorna il risultato completo
    return {
        users:   matchedUsers,
        posts:   matchedPosts,
        results: mergedResults,
        total:   matchedUsers.length + matchedPosts.length
    };
}

/* ═════════════════════════════════════════════════════════════════════════════
   ROUTE HTTP
   ═════════════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────────────────
   ROUTE HOME - Pagina principale con lista post
   ───────────────────────────────────────────────────────────────────────── */

app.get("/", (req, res) => {
    try {
        // Legge tutti i post dal file JSON
        const posts = readJSONFile(postsFile, []);
        // Renderizza la vista index.ejs con i post e l'utente corrente
        res.render("index", { posts, currentUser: res.locals.currentUser });
    } catch (error) {
        // In caso di errore, renderizza con lista vuota
        console.error("Errore nel caricamento dei post:", error);
        res.render("index", { posts: [], currentUser: res.locals.currentUser });
    }
});

/* ─────────────────────────────────────────────────────────────────────────
   ROUTE LOGIN - Accesso utente esistente
   ───────────────────────────────────────────────────────────────────────── */

// GET: mostra il form di login
app.get("/login", (req, res) => res.render("login", { error: null }));

// POST: elabora le credenziali inviate dal form
app.post("/login", (req, res) => {
    // Estrae username e password dal body del form
    const { username, password } = req.body;
    try {
        // Legge tutti gli utenti registrati
        const users = readJSONFile(usersFile, []);
        // Cerca l'utente con username e password corrispondenti
        const user  = users.find(u => u.username === username && u.password === password);
        if (user) {
            // Credenziali corrette: imposta il cookie di sessione e reindirizza alla home
            res.setHeader('Set-Cookie', `user=${encodeURIComponent(username)}; Path=/`);
            return res.redirect("/");
        }
        // Credenziali errate: mostra il form con messaggio di errore
        res.render("login", { error: "Credenziali errate" });
    } catch (error) {
        // Errore del server: mostra messaggio generico
        console.error("Errore nel login:", error);
        res.render("login", { error: "Errore nel server. Riprova." });
    }
});

/* ─────────────────────────────────────────────────────────────────────────
   ROUTE SIGNUP - Registrazione nuovo utente
   ───────────────────────────────────────────────────────────────────────── */

// GET: mostra il form di registrazione
app.get("/signup", (req, res) => res.render("signup", { error: null }));

// POST: elabora i dati di registrazione
app.post("/signup", (req, res) => {
    // Estrae username e password dal form
    const { username, password } = req.body;
    try {
        // Legge gli utenti esistenti
        const users = readJSONFile(usersFile, []);
        // Controlla se l'username è già preso
        if (users.some(u => u.username === username)) {
            return res.render("signup", { error: "Username già in uso" });
        }
        // Aggiunge il nuovo utente con campi di default
        users.push({
            username,                                    // Username scelto dall'utente
            password,                                    // Password (in produzione va hashata!)
            bio:       "",                               // Biografia vuota di default
            avatar:    username.charAt(0).toUpperCase(), // Avatar: iniziale maiuscola
            createdAt: new Date().toISOString()          // Timestamp di registrazione
        });
        // Salva il file aggiornato e imposta il cookie di sessione
        if (writeJSONFile(usersFile, users)) {
            res.setHeader('Set-Cookie', `user=${encodeURIComponent(username)}; Path=/`);
            return res.redirect("/");
        } else {
            // Errore nel salvataggio
            return res.render("signup", { error: "Errore nella registrazione" });
        }
    } catch (error) {
        // Errore del server
        console.error("Errore nella registrazione:", error);
        res.render("signup", { error: "Errore nel server. Riprova." });
    }
});

/* ─────────────────────────────────────────────────────────────────────────
   ROUTE LOGOUT - Cancella la sessione utente
   ───────────────────────────────────────────────────────────────────────── */

app.get("/logout", (req, res) => {
    // Sovrascrive il cookie con una data di scadenza nel passato per cancellarlo
    res.setHeader('Set-Cookie', 'user=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    // Reindirizza alla home
    res.redirect("/");
});

/* ─────────────────────────────────────────────────────────────────────────
   ROUTE POST - Creazione di un nuovo post
   ───────────────────────────────────────────────────────────────────────── */

// GET: mostra il form di creazione post (solo per utenti loggati)
app.get("/post", (req, res) => {
    // Reindirizza al login se l'utente non è autenticato
    if (!res.locals.currentUser) return res.redirect("/login");
    // Renderizza il form di creazione
    res.render("post", { error: null, currentUser: res.locals.currentUser });
});

// POST: elabora e salva il nuovo post
app.post("/post", (req, res) => {
    // Solo utenti autenticati possono creare post
    if (!res.locals.currentUser) return res.redirect("/login");

    // Estrae i campi del post dal form
    const { title, content, image, tags } = req.body;

    try {
        // Legge i post esistenti
        const posts = readJSONFile(postsFile, []);

        // Costruisce l'oggetto del nuovo post
        const newPost = {
            title,                                       // Titolo del post
            content,                                     // Contenuto testuale
            author:   res.locals.currentUser,            // Username dell'autore
            date:     new Date().toLocaleString(),        // Data/ora di creazione
            likes:    [],                                 // Nessun like inizialmente
            comments: [],                                 // Nessun commento inizialmente
            tags:     tags                               // Parsing dei tag (separa virgole, rimuove #)
                ? tags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean)
                : []
        };

        // Aggiunge l'immagine solo se è presente in formato base64
        if (image && image.length > 0 && image.startsWith('data:')) {
            newPost.image = image;
        }

        // Aggiunge il post all'array e salva
        posts.push(newPost);
        if (writeJSONFile(postsFile, posts)) {
            // Salvataggio riuscito: reindirizza alla home
            res.redirect("/");
        } else {
            // Errore nel salvataggio
            res.render("post", { error: "Errore nel salvataggio del post", currentUser: res.locals.currentUser });
        }
    } catch (error) {
        // Errore del server
        console.error("Errore nella creazione del post:", error);
        res.render("post", { error: "Errore nel server. Riprova.", currentUser: res.locals.currentUser });
    }
});

// POST: elimina un post (solo l'autore può farlo)
app.post("/delete-post/:postIndex", (req, res) => {
    // Solo utenti autenticati possono eliminare post
    if (!res.locals.currentUser) {
        return res.json({ error: 'Non autorizzato' });
    }

    // Converte il parametro in numero intero
    const postIndex = parseInt(req.params.postIndex, 10);
    // Legge i post
    const posts = readJSONFile(postsFile, []);

    // Verifica che l'indice sia valido
    if (isNaN(postIndex) || postIndex < 0 || postIndex >= posts.length) {
        return res.json({ error: 'Post non trovato' });
    }

    // Verifica che l'utente sia l'autore del post
    if (posts[postIndex].author !== res.locals.currentUser) {
        return res.json({ error: 'Non puoi eliminare post di altri utenti' });
    }

    // Rimuove il post dall'array e salva
    posts.splice(postIndex, 1);
    writeJSONFile(postsFile, posts);
    // Risponde con successo
    res.json({ success: true });
});

/* ─────────────────────────────────────────────────────────────────────────
   ROUTE LIKE - Aggiunge o rimuove un like a un post
   ───────────────────────────────────────────────────────────────────────── */

app.post("/like", (req, res) => {
    // Solo utenti autenticati possono mettere like
    if (!res.locals.currentUser) {
        return res.json({ error: 'Non autorizzato' });
    }

    // Estrae l'indice del post dal body
    const { postIndex } = req.body;
    // Legge i post
    const posts = readJSONFile(postsFile, []);
    // Converte in numero intero
    const idx   = parseInt(postIndex, 10);

    // Verifica che l'indice sia valido
    if (isNaN(idx) || idx < 0 || idx >= posts.length) {
        return res.json({ error: 'Post non trovato' });
    }

    // Inizializza l'array likes se non esiste
    if (!posts[idx].likes) posts[idx].likes = [];

    // Ottiene l'username dell'utente corrente
    const user    = res.locals.currentUser;
    // Cerca la posizione del like dell'utente nell'array
    const likePos = posts[idx].likes.indexOf(user);

    if (likePos === -1) {
        // L'utente non aveva ancora messo like: lo aggiunge
        posts[idx].likes.push(user);
    } else {
        // L'utente aveva già messo like: lo rimuove (toggle)
        posts[idx].likes.splice(likePos, 1);
    }

    // Salva i post aggiornati
    writeJSONFile(postsFile, posts);

    // Risponde con il nuovo totale like e lo stato (liked/unliked)
    res.json({
        likes: posts[idx].likes.length,
        liked: likePos === -1   // true = appena aggiunto, false = appena rimosso
    });
});

/* ─────────────────────────────────────────────────────────────────────────
   ROUTE COMMENTI - Aggiunge ed elimina commenti ai post
   ───────────────────────────────────────────────────────────────────────── */

// POST: aggiunge un commento a un post specifico
app.post("/comment/:postIndex", (req, res) => {
    // Solo utenti autenticati possono commentare
    if (!res.locals.currentUser) return res.redirect("/login");

    // Estrae il testo del commento
    const { text } = req.body;
    // Non accetta commenti vuoti
    if (!text || !text.trim()) return res.redirect("/");

    // Converte l'indice in numero intero
    const postIndex = parseInt(req.params.postIndex, 10);
    // Legge i post
    const posts = readJSONFile(postsFile, []);

    // Verifica che l'indice sia valido
    if (isNaN(postIndex) || postIndex < 0 || postIndex >= posts.length) {
        return res.redirect("/");
    }

    // Inizializza l'array commenti se non esiste
    if (!posts[postIndex].comments) posts[postIndex].comments = [];

    // Aggiunge il nuovo commento con autore, testo e data
    posts[postIndex].comments.push({
        author: res.locals.currentUser,   // Chi ha scritto il commento
        text:   text.trim(),              // Testo del commento (trimmed)
        date:   new Date().toLocaleString() // Data e ora di pubblicazione
    });

    // Salva i post aggiornati e reindirizza alla home
    writeJSONFile(postsFile, posts);
    res.redirect("/");
});

// POST: elimina un commento specifico (solo l'autore del commento può farlo)
app.post("/delete-comment/:postIndex/:commentIndex", (req, res) => {
    // Solo utenti autenticati possono eliminare commenti
    if (!res.locals.currentUser) return res.json({ error: 'Non autorizzato' });

    // Converte gli indici in numeri interi
    const postIndex    = parseInt(req.params.postIndex, 10);
    const commentIndex = parseInt(req.params.commentIndex, 10);
    // Legge i post
    const posts = readJSONFile(postsFile, []);

    // Verifica che gli indici siano validi
    if (isNaN(postIndex) || postIndex < 0 || postIndex >= posts.length ||
        isNaN(commentIndex) || commentIndex < 0) {
        return res.json({ error: 'Post o commento non trovato' });
    }

    // Recupera il post
    const post = posts[postIndex];
    // Verifica che il commento esista nell'array
    if (!post.comments || commentIndex >= post.comments.length) {
        return res.json({ error: 'Commento non trovato' });
    }

    // Solo l'autore del commento può cancellarlo
    if (post.comments[commentIndex].author !== res.locals.currentUser) {
        return res.json({ error: 'Non puoi cancellare commenti di altri utenti' });
    }

    // Rimuove il commento dall'array e salva
    post.comments.splice(commentIndex, 1);
    writeJSONFile(postsFile, posts);
    // Risponde con successo
    res.json({ success: true });
});

/* ─────────────────────────────────────────────────────────────────────────
   ROUTE PROFILI - Visualizzazione profili utente
   ───────────────────────────────────────────────────────────────────────── */

// GET: profilo di un utente specifico (per username)
app.get("/profile/:username", (req, res) => {
    // Estrae l'username dall'URL
    const targetUsername = req.params.username;
    // Legge tutti gli utenti
    const users = readJSONFile(usersFile, []);
    // Cerca l'utente con quell'username
    const targetUser = users.find(u => u.username === targetUsername);

    // Se l'utente non esiste, mostra pagina 404
    if (!targetUser) {
        return res.status(404).render("404", { message: "Utente non trovato" });
    }

    // Legge i post e filtra quelli dell'utente (in ordine inverso: più recenti prima)
    const posts     = readJSONFile(postsFile, []);
    const userPosts = posts
        .map((p, i) => ({ ...p, index: i }))  // Aggiunge l'indice originale
        .filter(p => p.author === targetUsername) // Solo post di questo utente
        .reverse();                               // Dal più recente al più vecchio

    // Calcola il totale dei like ricevuti dall'utente
    const totalLikes = userPosts.reduce((sum, post) => (
        sum + (Array.isArray(post.likes) ? post.likes.length : 0)
    ), 0);

    // Calcola il totale dei commenti ricevuti dall'utente
    const totalComments = userPosts.reduce((sum, post) => (
        sum + (Array.isArray(post.comments) ? post.comments.length : 0)
    ), 0);

    // Renderizza la pagina profilo con tutti i dati
    res.render("profile", {
        targetUser: {
            ...targetUser,
            avatar: targetUser.avatar || targetUsername.charAt(0).toUpperCase(),
            bio:    targetUser.bio || ""
        },
        userPosts,                                               // Post dell'utente
        currentUser: res.locals.currentUser,                     // Utente loggato
        isOwnProfile: res.locals.currentUser === targetUsername, // True se è il proprio profilo
        profileStats: {
            postCount:   userPosts.length,
            totalLikes,
            totalComments,
            memberSince: formatMonthYear(targetUser.createdAt)
        }
    });
});

// GET: /profile senza username → reindirizza al profilo dell'utente loggato
app.get("/profile", (req, res) => {
    // Richiede autenticazione
    if (!res.locals.currentUser) return res.redirect("/login");
    // Reindirizza al profilo dell'utente corrente
    res.redirect(`/profile/${res.locals.currentUser}`);
});

/* ─────────────────────────────────────────────────────────────────────────
   ROUTE RICERCA - Pagina e API di ricerca
   ───────────────────────────────────────────────────────────────────────── */

// GET: pagina di ricerca con risultati completi
app.get("/search", (req, res) => {
    // Estrae la query dalla query string
    const query = String(req.query.q || "").trim();
    // Renderizza la pagina search con i risultati
    res.render("search", {
        query,
        results:     buildSearchResults(query),
        currentUser: res.locals.currentUser
    });
});

// GET: API JSON per l'autocomplete della ricerca
app.get("/api/search", (req, res) => {
    // Restituisce i risultati in formato JSON (usato dal dropdown)
    return res.json(buildSearchResults(req.query.q));
});

/* ─────────────────────────────────────────────────────────────────────────
   ROUTE CHAT - Pagina della chat live
   ───────────────────────────────────────────────────────────────────────── */

app.get("/chat", (req, res) => {
    // Solo utenti autenticati possono accedere alla chat
    if (!res.locals.currentUser) return res.redirect("/login");
    // Renderizza la pagina chat passando l'utente corrente
    res.render("chat", { currentUser: res.locals.currentUser });
});

/* ═════════════════════════════════════════════════════════════════════════════
   WEBSOCKET - Gestione della chat real-time
   
   FIX BUG SESSIONE: Il problema originale era che l'username veniva letto
   SOLO dal cookie HTTP al momento dell'handshake WebSocket. Se due browser
   diversi usavano lo stesso localhost, cambiando utente nel browser B il
   cookie veniva aggiornato, ma quando il browser A navigava via dalla chat
   e tornava, il server leggeva il nuovo cookie (dell'utente B) e mostrava
   il profilo sbagliato.
   
   SOLUZIONE: Il client invia esplicitamente il proprio username tramite un
   messaggio WS di tipo 'auth' subito dopo la connessione. Il server usa
   questo valore (che viene dall'EJS renderizzato con il cookie HTTP corretto
   AL MOMENTO del caricamento della pagina) invece di leggere il cookie
   di handshake WS, che può essere obsoleto o di un'altra sessione.
   ═════════════════════════════════════════════════════════════════════════════ */

wss.on('connection', (ws, req) => {
    console.log('Nuova connessione WebSocket');

    // ── IDENTIFICAZIONE INIZIALE ──────────────────────────────────────────────
    // Username temporaneo letto dal cookie HTTP dell'handshake WS.
    // Verrà SOVRITTO dal messaggio 'auth' inviato dal client (più affidabile).
    let username = "Anonimo";
    if (req.headers.cookie) {
        // Estrae il cookie 'user' dall'header
        const cookies    = req.headers.cookie.split('; ');
        const userCookie = cookies.find(c => c.startsWith('user='));
        if (userCookie) username = decodeURIComponent(userCookie.split('=')[1]);
    }

    // Registra provvisoriamente il client con l'username dal cookie
    onlineUsers.set(ws, username);

    // Aggiorna subito il contatore utenti online
    broadcastOnlineCount();

    // ── GESTIONE MESSAGGI IN ARRIVO ──────────────────────────────────────────
    ws.on('message', (message) => {
        try {
            // Converte il messaggio da stringa JSON a oggetto JS
            const data = JSON.parse(message);

            // ── TIPO: auth ────────────────────────────────────────────────────
            // Il client invia il proprio username autentico subito dopo la connessione.
            // Questo risolve il bug per cui due browser sullo stesso host
            // potevano "scambiarsi" l'identità se il cookie cambiava tra le sessioni.
            if (data.type === 'auth') {
                const newName = String(data.username || '').trim();
                if (newName && newName !== username) {
                    // Aggiorna l'username nella mappa degli utenti online
                    onlineUsers.delete(ws);
                    username = newName;
                    onlineUsers.set(ws, username);
                }
                // Invia il messaggio di benvenuto solo DOPO aver autenticato l'username
                ws.send(JSON.stringify({
                    type:      'system',
                    message:   `Benvenuto nella chat, ${username}!`,
                    timestamp: new Date().toISOString()
                }));
                // Notifica agli altri utenti che questo utente è entrato
                wss.clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type:      'system',
                            message:   `${username} si è unito alla chat`,
                            timestamp: new Date().toISOString()
                        }));
                    }
                });
                // Aggiorna il contatore con l'username corretto
                broadcastOnlineCount();
                return; // Non propagare il messaggio 'auth'
            }

            // ── TIPO: chat ────────────────────────────────────────────────────
            // Messaggio di testo normale: viene inoltrato a tutti i client connessi
            if (data.type === 'chat') {
                // Costruisce il messaggio da distribuire
                const chatMessage = {
                    type:      'chat',
                    username:  username,           // Username autenticato tramite 'auth'
                    message:   data.message,        // Testo del messaggio
                    timestamp: new Date().toISOString()
                };
                // Invia a tutti i client connessi (incluso il mittente)
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(chatMessage));
                    }
                });

            // ── TIPO: typing ──────────────────────────────────────────────────
            // Segnale "sta scrivendo": inviato agli altri utenti (non al mittente)
            } else if (data.type === 'typing') {
                wss.clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type:     'typing',
                            username: username
                        }));
                    }
                });

            // ── TIPO: stop_typing ─────────────────────────────────────────────
            // Segnale "ha smesso di scrivere": inviato agli altri utenti
            } else if (data.type === 'stop_typing') {
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
            // Logga eventuali errori di parsing del messaggio
            console.error('Errore nel parsing del messaggio:', error);
        }
    });

    // ── GESTIONE CHIUSURA CONNESSIONE ────────────────────────────────────────
    ws.on('close', () => {
        console.log(`${username} ha lasciato la chat`);

        // Rimuove il client dalla mappa degli utenti online
        onlineUsers.delete(ws);

        // Notifica a tutti gli altri utenti che questo utente è uscito
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type:      'system',
                    message:   `${username} ha lasciato la chat`,
                    timestamp: new Date().toISOString()
                }));
            }
        });

        // Aggiorna il contatore utenti online
        broadcastOnlineCount();
    });

    // ── GESTIONE ERRORI WEBSOCKET ────────────────────────────────────────────
    ws.on('error', (error) => {
        console.error('Errore WebSocket:', error);
    });
});

/* ─────────────────────────────────────────────────────────────────────────
   AVVIO SERVER
   ───────────────────────────────────────────────────────────────────────── */

// Avvia il server HTTP (usa server.listen e non app.listen per supportare WS)
server.listen(PORT, () => console.log(`Server avviato su http://localhost:${PORT}`));
