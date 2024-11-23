const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  makeInMemoryStore,
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const log = pino;
const { session } = { session: "session_auth_info" };
const { Boom } = require("@hapi/boom");
const express = require("express");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const bodyParser = require("body-parser");
const app = require("express")();
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const qrcode = require("qrcode");
const XLSX = require("xlsx");
const path = require("path");

app.use("/assets", express.static(__dirname + "/client/assets"));

// Rutas
app.get("/scan", (req, res) => {
  res.sendFile("./client/index.html", {
    root: __dirname,
  });
});

app.get("/prototype-groups", (req, res) => {
  res.sendFile("./client/prototype-groups.html", {
    root: __dirname,
  });
});

app.get("/prototype-topics", (req, res) => {
  res.sendFile("./client/prototype-topics.html", {
    root: __dirname,
  });
});

app.get("/chat", (req, res) => {
  res.sendFile("./client/chat.html", {
    root: __dirname,
  });
});

let sock;
let qrDinamic;
let soket;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("session_auth_info");

  sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    qrDinamic = qr;

    if (connection === "close") {
      let reason = new Boom(lastDisconnect.error).output.statusCode;
      if (
        reason === DisconnectReason.loggedOut ||
        reason === DisconnectReason.badSession
      ) {
        console.log("Sesión cerrada, necesita escanear de nuevo");
      } else {
        console.log("Conexión cerrada, reconectando...");
        connectToWhatsApp();
      }
    } else if (connection === "open") {
      console.log("Conexión establecida");
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

io.on("connection", async (socket) => {
  soket = socket;
  if (sock?.user) {
    updateQR("connected");
  } else if (qrDinamic) {
    updateQR("qr");
  }
});

const updateQR = (data) => {
  console.log("Actualizando QR:", data); // Log para depuración
  switch (data) {
    case "qr":
      qrcode.toDataURL(qrDinamic, (err, url) => {
        soket?.emit("qr", url);
        console.log("QR enviado al cliente");
      });
      break;
    case "connected":
      console.log("Enviando estado conectado");
      soket?.emit("qrstatus", "./assets/check.svg");
      if (sock?.user) {
        const userinfo = sock.user.id + " " + sock.user.name;
        console.log("Enviando info de usuario:", userinfo);
        soket?.emit("user", userinfo);
      }
      break;
    case "loading":
      soket?.emit("qrstatus", "./assets/loader.gif");
      break;
  }
};

// Función para leer los Excel y obtener la información
function readExcelFile(groupId) {
    const excelPath = path.join(__dirname, `data/grupo_${groupId}.xlsx`);
    const workbook = XLSX.readFile(excelPath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);
    return data;
}

// Función para obtener temas únicos de un grupo
function getUniqueTopics(groupId) {
    const data = readExcelFile(groupId);
    const topics = [...new Set(data.map(row => row.Tema))];
    return topics;
}

// Función para obtener mensajes de un tema específico
function getMessagesForTopic(groupId, topic) {
    const data = readExcelFile(groupId);
    return data.filter(row => row.Tema === topic)
        .map(row => ({
            participante: row.Participante,
            mensaje: row.Mensaje
        }));
}

function getTopicSummaries(groupId) {
  const summaryPath = path.join(__dirname, "data/temas_prototipo.xlsx");
  const workbook = XLSX.readFile(summaryPath);
  // Las hojas están en orden 1, 2, 3 correspondiendo a cada grupo
  const sheet = workbook.Sheets[workbook.SheetNames[groupId - 1]];
  const data = XLSX.utils.sheet_to_json(sheet);
  console.log("DATA EXCEL", data);
  // Crear un objeto con tema como clave y resumen como valor
  return data.reduce((acc, row) => {
    acc[row.Tema] = row.Resumen;
    return acc;
  }, {});
}

// Rutas API para obtener datos
app.get("/api/topics/:groupId", (req, res) => {
  try {
    const { groupId } = req.params;
    const topics = getUniqueTopics(groupId);
    const summaries = getTopicSummaries(groupId);
    console.log(summaries);
    // Combinar temas con sus resúmenes
    const topicsWithSummaries = topics.map((topic) => ({
      nombre: topic,
      resumen: summaries[topic] || "No hay resumen disponible",
    }));

    res.json({ success: true, topics: topicsWithSummaries });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/messages/:groupId/:topic", (req, res) => {
  try {
    const { groupId, topic } = req.params;
    const messages = getMessagesForTopic(groupId, decodeURIComponent(topic));
    res.json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});



connectToWhatsApp();

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log("Server Run Port : " + port);
});