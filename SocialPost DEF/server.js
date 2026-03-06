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
app.use(express.urlencoded({ extended: true }));
// Imposta EJS come motore di template per le viste
app.set("view engine", "ejs");

// Definisce i percorsi dei file JSON per utenti e post
const usersFile = path.join(__dirname, "utenti.json");
const postsFile = path.join(__dirname, "posts.json");

// Middleware per gestire i cookie dell'utente
app.use((req, res, next) => {
    if (req.headers.cookie) {
        // Se ci sono cookie, li dividiamo in un array
        const cookies = req.headers.cookie.split('; ');
        // Cerchiamo il cookie dell'utente
        const userCookie = cookies.find(c => c.startsWith('user='));
        // Decodifichiamo l'username dall'URL e lo salviamo in res.locals
        res.locals.currentUser = userCookie ? decodeURIComponent(userCookie.split('=')[1]) : null;
    } else {
        // Se non ci sono cookie, l'utente non è loggato
        res.locals.currentUser = null;
    }
    next(); // Passa alla prossima funzione middleware
});

// Funzione helper per leggere file JSON con gestione errori
function readJSONFile(filePath, defaultData = []) {
    try {
        if (!fs.existsSync(filePath)) {
            return defaultData;
        }
        const data = fs.readFileSync(filePath, 'utf8');
        if (!data.trim()) {
            return defaultData;
        }
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
        // Legge i post dal file JSON
        const posts = readJSONFile(postsFile, []);
        // Renderizza la pagina index.ejs passando i post
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
    // Prende username e password dal form
    const { username, password } = req.body;
    
    try {
        // Legge il file degli utenti
        const users = readJSONFile(usersFile, []);
        
        // Cerca l'utente con username e password corrispondenti
        const user = users.find(u => u.username === username && u.password === password);
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

// Route per la pagina di registrazione (GET)
app.get("/signup", (req, res) => res.render("signup", { error: null }));

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

// Route per il logout
app.get("/logout", (req, res) => {
    // Cancella il cookie impostando una data di scadenza passata
    res.setHeader('Set-Cookie', 'user=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    res.redirect("/");
});

// Route per la pagina di creazione post (GET)
app.get("/post", (req, res) => {
    // Se l'utente non è loggato, reindirizza al login
    if (!res.locals.currentUser) return res.redirect("/login");
    res.render("post", { error: null });
});

// Route per il form di creazione post (POST)
app.post("/post", (req, res) => {
    if (!res.locals.currentUser) return res.redirect("/login");
    
    // Prende titolo e contenuto dal form
    const { title, content } = req.body;
    
    try {
        // Legge i post esistenti
        const posts = readJSONFile(postsFile, []);
        
        // Aggiunge il nuovo post con autore e data
        posts.push({
            title,
            content,
            author: res.locals.currentUser, // Prende l'utente corrente
            date: new Date().toLocaleString() // Aggiunge la data corrente
        });
        
        // Salva i post aggiornati
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

// Route per la pagina chat
app.get("/chat", (req, res) => {
    // Se l'utente non è loggato, reindirizza al login
    if (!res.locals.currentUser) return res.redirect("/login");
    res.render("chat", { currentUser: res.locals.currentUser });
});

// Gestione connessioni WebSocket
wss.on('connection', (ws, req) => {
    console.log('Nuova connessione WebSocket');
    
    // Estrai il nome utente dai cookie
    let username = "Anonimo";
    if (req.headers.cookie) {
        const cookies = req.headers.cookie.split('; ');
        const userCookie = cookies.find(c => c.startsWith('user='));
        if (userCookie) {
            username = decodeURIComponent(userCookie.split('=')[1]);
        }
    }
    
    // Invia messaggio di benvenuto
    ws.send(JSON.stringify({
        type: 'system',
        message: `Benvenuto nella chat, ${username}!`,
        timestamp: new Date().toISOString()
    }));
    
    // Notifica a tutti gli altri utenti
    wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'system',
                message: `${username} si è unito alla chat`,
                timestamp: new Date().toISOString()
            }));
        }
    });
    
    // Gestione messaggi in arrivo
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
                
                // Invia a tutti i client connessi
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
    
    // Gestione chiusura connessione
    ws.on('close', () => {
        console.log(`${username} ha lasciato la chat`);
        
        // Notifica a tutti gli altri utenti
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
    
    // Gestione errori
    ws.on('error', (error) => {
        console.error('Errore WebSocket:', error);
    });
});

// Avvia il server HTTP (non più app.listen)
server.listen(PORT, () => console.log(`Server avviato su http://localhost:${PORT}`));