const express = require("express");
const fs      = require("fs");
const path    = require("path");
const http    = require("http");
const WebSocket = require("ws");

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });
const PORT   = 3000;

const usersFile = path.join(__dirname, "utenti.json");
const postsFile = path.join(__dirname, "posts.json");

// ── Configurazione Express ────────────────────────────────────────────────────
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.json({ limit: "10mb" }));
app.set("view engine", "ejs");

// ── Helpers ───────────────────────────────────────────────────────────────────

// Estrae lo username dal cookie header (usato sia dal middleware che da WebSocket)
function getUserFromCookies(cookieHeader) {
    if (!cookieHeader) return null;
    const match = cookieHeader.split("; ").find(c => c.startsWith("user="));
    return match ? decodeURIComponent(match.split("=")[1]) : null;
}

// Legge un file JSON restituendo defaultData in caso di errore o assenza
function readJSONFile(filePath, defaultData = []) {
    try {
        if (!fs.existsSync(filePath)) return defaultData;
        const raw = fs.readFileSync(filePath, "utf8");
        return raw.trim() ? JSON.parse(raw) : defaultData;
    } catch (err) {
        console.error(`Errore lettura ${filePath}:`, err);
        return defaultData;
    }
}

// Scrive dati su un file JSON, restituisce true/false
function writeJSONFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (err) {
        console.error(`Errore scrittura ${filePath}:`, err);
        return false;
    }
}

// ── Middleware: lettura cookie utente ─────────────────────────────────────────
app.use((req, res, next) => {
    res.locals.currentUser = getUserFromCookies(req.headers.cookie);
    next();
});

// ── Route: Home ───────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
    const posts = readJSONFile(postsFile, []);
    res.render("index", { posts });
});

// ── Route: Login ──────────────────────────────────────────────────────────────
app.get("/login", (req, res) => res.render("login", { error: null }));

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const users = readJSONFile(usersFile, []);
    const user  = users.find(u => u.username === username && u.password === password);

    if (!user) return res.render("login", { error: "Credenziali errate" });

    res.setHeader("Set-Cookie", `user=${encodeURIComponent(username)}; Path=/`);
    res.redirect("/");
});

// ── Route: Registrazione ──────────────────────────────────────────────────────
app.get("/signup", (req, res) => res.render("signup", { error: null }));

app.post("/signup", (req, res) => {
    const { username, password } = req.body;
    const users = readJSONFile(usersFile, []);

    if (users.some(u => u.username === username))
        return res.render("signup", { error: "Username già in uso" });

    users.push({ username, password });
    if (!writeJSONFile(usersFile, users))
        return res.render("signup", { error: "Errore nella registrazione" });

    res.setHeader("Set-Cookie", `user=${encodeURIComponent(username)}; Path=/`);
    res.redirect("/");
});

// ── Route: Logout ─────────────────────────────────────────────────────────────
app.get("/logout", (req, res) => {
    res.setHeader("Set-Cookie", "user=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    res.redirect("/");
});

// ── Route: Crea Post ──────────────────────────────────────────────────────────
app.get("/post", (req, res) => {
    if (!res.locals.currentUser) return res.redirect("/login");
    res.render("post", { error: null });
});

app.post("/post", (req, res) => {
    if (!res.locals.currentUser) return res.redirect("/login");

    const { title, content, image } = req.body;
    const posts   = readJSONFile(postsFile, []);
    const newPost = {
        title,
        content,
        author: res.locals.currentUser,
        date: new Date().toLocaleString(),
        likes: [],
        comments: []
    };

    if (image && image.startsWith("data:image/")) newPost.image = image;

    posts.push(newPost);
    if (!writeJSONFile(postsFile, posts))
        return res.render("post", { error: "Errore nel salvataggio del post" });

    res.redirect("/");
});

// ── Route: Like (risponde con JSON per AJAX) ──────────────────────────────────
app.post("/like/:index", (req, res) => {
    const user  = res.locals.currentUser;
    if (!user) return res.json({ error: "Non autenticato" });

    const index = parseInt(req.params.index);
    const posts = readJSONFile(postsFile, []);

    if (index < 0 || index >= posts.length)
        return res.json({ error: "Post non trovato" });

    const post  = posts[index];
    if (!post.likes) post.likes = [];

    const i      = post.likes.indexOf(user);
    const liked  = i === -1;
    liked ? post.likes.push(user) : post.likes.splice(i, 1);

    writeJSONFile(postsFile, posts);
    res.json({ count: post.likes.length, liked });
});

// ── Route: Commento ───────────────────────────────────────────────────────────
app.post("/comment/:index", (req, res) => {
    const user = res.locals.currentUser;
    if (!user) return res.redirect("/login");

    const { text } = req.body;
    if (!text?.trim()) return res.redirect("/");

    const index = parseInt(req.params.index);
    const posts = readJSONFile(postsFile, []);

    if (index < 0 || index >= posts.length) return res.redirect("/");

    if (!posts[index].comments) posts[index].comments = [];
    posts[index].comments.push({ author: user, text: text.trim(), date: new Date().toLocaleString() });

    writeJSONFile(postsFile, posts);
    res.redirect("/");
});

// ── Route: Chat ───────────────────────────────────────────────────────────────
app.get("/chat", (req, res) => {
    if (!res.locals.currentUser) return res.redirect("/login");
    res.render("chat", { currentUser: res.locals.currentUser });
});

// ── WebSocket: Chat in tempo reale ────────────────────────────────────────────
function broadcast(wss, payload, exclude = null) {
    const msg = JSON.stringify(payload);
    wss.clients.forEach(client => {
        if (client !== exclude && client.readyState === WebSocket.OPEN)
            client.send(msg);
    });
}

wss.on("connection", (ws, req) => {
    const username = getUserFromCookies(req.headers.cookie) || "Anonimo";

    // Messaggio di benvenuto solo al nuovo utente
    ws.send(JSON.stringify({
        type: "system",
        message: `Benvenuto nella chat, ${username}!`,
        timestamp: new Date().toISOString()
    }));

    // Notifica ingresso agli altri
    broadcast(wss, {
        type: "system",
        message: `${username} si è unito alla chat`,
        timestamp: new Date().toISOString()
    }, ws);

    ws.on("message", raw => {
        try {
            const data = JSON.parse(raw);
            if (data.type !== "chat") return;
            broadcast(wss, {
                type: "chat",
                username,
                message: data.message,
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            console.error("Errore parsing messaggio WebSocket:", err);
        }
    });

    ws.on("close", () => {
        broadcast(wss, {
            type: "system",
            message: `${username} ha lasciato la chat`,
            timestamp: new Date().toISOString()
        });
    });

    ws.on("error", err => console.error("Errore WebSocket:", err));
});

// ── Avvio server ──────────────────────────────────────────────────────────────
server.listen(PORT, () => console.log(`Server avviato su http://localhost:${PORT}`));
