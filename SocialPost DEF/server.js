// Importa i moduli necessari
const express = require("express"); // Framework per creare il server web
const fs = require("fs"); // Modulo per lavorare con i file
const path = require("path"); // Modulo per gestire i percorsi dei file
const http = require("http"); // Modulo HTTP per WebSocket
const WebSocket = require("ws"); // Modulo WebSocket

// Crea un'applicazione Express
const app = express();
// Crea un server HTTP dall'app Express
const server = http.createServer(app);
// Crea un server WebSocket sul server HTTP
const wss = new WebSocket.Server({ server });

// Imposta la porta su cui il server ascolterà
const PORT = 3000;

// Configura Express per servire file statici dalla cartella 'public'
app.use(express.static("public"));
// Abilita il parsing dei dati inviati dai form HTML
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
// Imposta EJS come motore di template per le viste
app.set("view engine", "ejs");

// Definisce i percorsi dei file JSON per utenti e post
const usersFile = path.join(__dirname, "utenti.json");
const postsFile = path.join(__dirname, "posts.json");

// Middleware per gestire i cookie dell'utente
app.use((req, res, next) => {
    if (req.headers.cookie) {
        const cookies = req.headers.cookie.split('; ');
        const userCookie = cookies.find(c => c.startsWith('user='));
        res.locals.currentUser = userCookie ? decodeURIComponent(userCookie.split('=')[1]) : null;
    } else {
        res.locals.currentUser = null;
    }
    next();
});

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

// Route per la home page
app.get("/", (req, res) => {
    try {
        const posts = readJSONFile(postsFile, []);
        res.render("index", { posts });
    } catch (error) {
        console.error("Errore nel caricamento dei post:", error);
        res.render("index", { posts: [] });
    }
});

// Route per la pagina di login (GET)
app.get("/login", (req, res) => res.render("login", { error: null }));

// Route per il form di login (POST)
app.post("/login", (req, res) => {
    const { username, password } = req.body;
    try {
        const users = readJSONFile(usersFile, []);
        const user = users.find(u => u.username === username && u.password === password);
        if (user) {
            res.setHeader('Set-Cookie', `user=${encodeURIComponent(username)}; Path=/`);
            return res.redirect("/");
        }
        res.render("login", { error: "Credenziali errate" });
    } catch (error) {
        console.error("Errore nel login:", error);
        res.render("login", { error: "Errore nel server. Riprova." });
    }
});

// Route per la pagina di registrazione (GET)
app.get("/signup", (req, res) => res.render("signup", { error: null }));

// Route per il form di registrazione (POST)
app.post("/signup", (req, res) => {
    const { username, password } = req.body;
    try {
        const users = readJSONFile(usersFile, []);
        if (users.some(u => u.username === username)) {
            return res.render("signup", { error: "Username già in uso" });
        }
        users.push({ username, password });
        if (writeJSONFile(usersFile, users)) {
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

// Route per il logout
app.get("/logout", (req, res) => {
    res.setHeader('Set-Cookie', 'user=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    res.redirect("/");
});

// Route per la pagina di creazione post (GET)
app.get("/post", (req, res) => {
    if (!res.locals.currentUser) return res.redirect("/login");
    res.render("post", { error: null });
});

// Route per il form di creazione post (POST)
app.post("/post", (req, res) => {
    if (!res.locals.currentUser) return res.redirect("/login");

    const { title, content, image } = req.body;

    try {
        const posts = readJSONFile(postsFile, []);

        const newPost = {
            title,
            content,
            author: res.locals.currentUser,
            date: new Date().toLocaleString(),
            likes: [],
            comments: []
        };

        // Salva l'immagine solo se presente e valida
        if (image && image.startsWith('data:image/')) {
            newPost.image = image;
        }

        posts.push(newPost);

        if (writeJSONFile(postsFile, posts)) {
            res.redirect("/");
        } else {
            res.render("post", { error: "Errore nel salvataggio del post" });
        }
    } catch (error) {
        console.error("Errore nella creazione del post:", error);
        res.render("post", { error: "Errore nel server. Riprova." });
    }
});

// Route per il like (POST, risponde con JSON)
app.post("/like/:index", (req, res) => {
    const user = res.locals.currentUser;
    if (!user) return res.json({ error: "Non autenticato" });

    const index = parseInt(req.params.index);
    const posts = readJSONFile(postsFile, []);

    if (index < 0 || index >= posts.length) return res.json({ error: "Post non trovato" });

    if (!posts[index].likes) posts[index].likes = [];

    const likedIndex = posts[index].likes.indexOf(user);
    let liked;
    if (likedIndex === -1) {
        posts[index].likes.push(user);  // Aggiunge like
        liked = true;
    } else {
        posts[index].likes.splice(likedIndex, 1); // Rimuove like
        liked = false;
    }

    writeJSONFile(postsFile, posts);
    res.json({ count: posts[index].likes.length, liked });
});

// Route per aggiungere un commento (POST)
app.post("/comment/:index", (req, res) => {
    const user = res.locals.currentUser;
    if (!user) return res.redirect("/login");

    const index = parseInt(req.params.index);
    const { text } = req.body;

    if (!text || !text.trim()) return res.redirect("/");

    const posts = readJSONFile(postsFile, []);

    if (index < 0 || index >= posts.length) return res.redirect("/");

    if (!posts[index].comments) posts[index].comments = [];

    posts[index].comments.push({
        author: user,
        text: text.trim(),
        date: new Date().toLocaleString()
    });

    writeJSONFile(postsFile, posts);
    res.redirect("/");
});

// Route per la pagina chat
app.get("/chat", (req, res) => {
    if (!res.locals.currentUser) return res.redirect("/login");
    res.render("chat", { currentUser: res.locals.currentUser });
});

// Gestione connessioni WebSocket
wss.on('connection', (ws, req) => {
    console.log('Nuova connessione WebSocket');

    let username = "Anonimo";
    if (req.headers.cookie) {
        const cookies = req.headers.cookie.split('; ');
        const userCookie = cookies.find(c => c.startsWith('user='));
        if (userCookie) username = decodeURIComponent(userCookie.split('=')[1]);
    }

    ws.send(JSON.stringify({
        type: 'system',
        message: `Benvenuto nella chat, ${username}!`,
        timestamp: new Date().toISOString()
    }));

    wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'system',
                message: `${username} si è unito alla chat`,
                timestamp: new Date().toISOString()
            }));
        }
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'chat') {
                const chatMessage = {
                    type: 'chat',
                    username: username,
                    message: data.message,
                    timestamp: new Date().toISOString()
                };
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(chatMessage));
                    }
                });
            }
        } catch (error) {
            console.error('Errore nel parsing del messaggio:', error);
        }
    });

    ws.on('close', () => {
        console.log(`${username} ha lasciato la chat`);
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'system',
                    message: `${username} ha lasciato la chat`,
                    timestamp: new Date().toISOString()
                }));
            }
        });
    });

    ws.on('error', (error) => {
        console.error('Errore WebSocket:', error);
    });
});

// Avvia il server HTTP
server.listen(PORT, () => console.log(`Server avviato su http://localhost:${PORT}`));
