/**
 * Builds docs/INFORME.docx, the written report for the course.
 *
 * Run with: node docs/build-informe.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ImageRun,
  PageBreak,
  PageOrientation,
  LevelFormat,
} = require("docx");

const DOCS = __dirname;
const SHOTS = path.join(DOCS, "captures", "screenshots");

// US Letter, one-inch margins: 12240 - 2880 = 9360 DXA of usable width.
const PAGE_WIDTH = 12240;
const CONTENT_WIDTH = 9360;

/** @param {string} text */
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 160, line: 300 },
    alignment: opts.alignment,
    children: [new TextRun({ text, bold: opts.bold, italics: opts.italics, size: opts.size })],
  });
}

/** Paragraph built from alternating plain/bold segments. */
function rich(segments, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 160, line: 300 },
    children: segments.map((s) =>
      typeof s === "string"
        ? new TextRun({ text: s })
        : new TextRun({ text: s.text, bold: s.bold, italics: s.italics, font: s.mono ? "Consolas" : undefined }),
    ),
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 200 },
    children: [new TextRun({ text, bold: true, size: 30, color: "000000" })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 160 },
    children: [new TextRun({ text, bold: true, size: 25, color: "000000" })],
  });
}

/** Fixed-width block for protocol snippets. */
function code(lines) {
  return lines.map(
    (line, index) =>
      new Paragraph({
        spacing: { after: index === lines.length - 1 ? 200 : 0, line: 240 },
        indent: { left: 360 },
        children: [new TextRun({ text: line || " ", font: "Consolas", size: 18 })],
      }),
  );
}

/**
 * Plain table: no shading, no colour, header row in bold.
 *
 * @param {string[]} headers
 * @param {string[][]} rows
 * @param {number[]} weights Relative column widths.
 */
function table(headers, rows, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.round((w / total) * CONTENT_WIDTH));

  const border = { style: BorderStyle.SINGLE, size: 1, color: "999999" };
  const borders = { top: border, bottom: border, left: border, right: border };

  const buildRow = (cells, bold) =>
    new TableRow({
      tableHeader: bold,
      children: cells.map(
        (text, i) =>
          new TableCell({
            width: { size: widths[i], type: WidthType.DXA },
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [
              new Paragraph({
                spacing: { after: 0, line: 260 },
                children: [new TextRun({ text, bold, size: 19 })],
              }),
            ],
          }),
      ),
    });

  return new Table({
    columnWidths: widths,
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    borders,
    rows: [buildRow(headers, true), ...rows.map((r) => buildRow(r, false))],
  });
}

/**
 * Embeds a screenshot with a caption underneath.
 *
 * @param {string} file
 * @param {number} width
 * @param {number} height
 * @param {string} caption
 */
function figure(file, width, height, caption) {
  return [
    new Paragraph({
      spacing: { before: 120, after: 60 },
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          type: "png",
          data: fs.readFileSync(path.join(SHOTS, file)),
          transformation: { width, height },
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 240 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: caption, italics: true, size: 18 })],
    }),
  ];
}

const children = [];

// ---------------------------------------------------------------------------
// Portada
// ---------------------------------------------------------------------------

children.push(
  new Paragraph({ spacing: { before: 1800, after: 0 } }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: "Universidad del Valle de Guatemala", size: 24 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: "Facultad de Ingeniería", size: 24 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 },
    children: [new TextRun({ text: "Departamento de Ciencias de la Computación", size: 24 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
    children: [new TextRun({ text: "CC3067 Redes", size: 26, bold: true })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: "Proyecto 1", size: 40, bold: true })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 800 },
    children: [new TextRun({ text: "Uso de un protocolo existente: Model Context Protocol", size: 28 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: "[Nombre completo]", size: 24 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: "[Carné]", size: 24 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: "Agosto de 2026", size: 22 })],
  }),
  new Paragraph({ children: [new PageBreak()] }),
);

// ---------------------------------------------------------------------------
// 1. Introducción
// ---------------------------------------------------------------------------

children.push(h1("1. Introducción"));

children.push(
  p(
    "Este proyecto consiste en un chatbot de terminal que funciona como anfitrión de Model Context Protocol (MCP). El chatbot se comunica con un modelo de lenguaje a través de su API, mantiene el contexto de la conversación y se conecta a varios servidores MCP que le dan acceso a herramientas externas: el sistema de archivos, un repositorio Git y un servidor propio de logística que se ejecuta tanto de forma local como en la nube.",
  ),
  p(
    "MCP utiliza JSON-RPC 2.0, un protocolo de la capa de aplicación. Siguiendo lo indicado en el enunciado, todo el protocolo se implementó de forma manual: no se utilizó ningún SDK ni framework de MCP. El código construye, delimita, envía, recibe y valida cada mensaje por su cuenta, tanto del lado del cliente como del lado del servidor.",
  ),
  p(
    "El repositorio del proyecto se encuentra en https://github.com/GenserDev/Redes-Proyecto-1 y el servidor MCP remoto está publicado en https://logistics-mcp.mcp-chatbot.workers.dev.",
  ),
);

children.push(h2("Funcionalidades implementadas"));

children.push(
  table(
    ["#", "Funcionalidad", "Estado"],
    [
      ["1", "Conexión con un LLM a nivel de su API", "Implementada"],
      ["2", "Mantener contexto en una sesión", "Implementada"],
      ["3", "Log de las interacciones con los servidores MCP", "Implementada"],
      ["4", "Uso de los servidores MCP oficiales Filesystem y Git", "Implementada"],
      ["5", "Servidor MCP propio ejecutado localmente", "Implementada"],
      ["6", "El mismo servidor MCP ejecutado de forma remota", "Implementada"],
      ["7", "Análisis de la comunicación con Wireshark", "Implementada"],
      ["8, 9, 10", "Reporte escrito", "Este documento"],
    ],
    [1, 7, 2],
  ),
  p(""),
);

children.push(h2("Tecnologías utilizadas"));

children.push(
  table(
    ["Componente", "Tecnología"],
    [
      ["Lenguaje y entorno", "Node.js 24, JavaScript con módulos ESM"],
      ["Dependencias", "chalk (colores en terminal) y dotenv (variables de entorno)"],
      ["Protocolo", "JSON-RPC 2.0, revisión MCP 2025-06-18"],
      ["Modelo de lenguaje", "Google Gemini 3.7 Flash (también Groq y Anthropic)"],
      ["Servidores MCP oficiales", "Filesystem (Node) y Git (Python)"],
      ["Nube", "Cloudflare Workers, desplegado con Wrangler"],
      ["Análisis de red", "Wireshark y tshark"],
    ],
    [3, 7],
  ),
  p(""),
);

children.push(
  p(
    "El chatbot se conecta a cuatro servidores MCP. Los dos primeros son oficiales de Anthropic y se ejecutan como procesos hijos. El tercero y el cuarto son el mismo servidor propio, alcanzado por dos vías distintas.",
  ),
  table(
    ["Servidor", "Transporte", "Herramientas"],
    [
      ["filesystem", "stdio", "14"],
      ["git", "stdio", "12"],
      ["logistics", "stdio", "4"],
      ["logistics-remote", "HTTP", "4"],
    ],
    [4, 3, 3],
  ),
  p(""),
);

children.push(new Paragraph({ children: [new PageBreak()] }));

// ---------------------------------------------------------------------------
// 2. Especificación del servidor MCP (requisito 8)
// ---------------------------------------------------------------------------

children.push(h1("2. Especificación del servidor MCP desarrollado"));

children.push(
  p(
    "El caso de uso elegido, aprobado previamente por el catedrático, es el de una empresa guatemalteca de paquetería. El servidor permite que un chatbot de atención al cliente cotice un envío, lo registre, lo rastree y liste los envíos de un cliente.",
  ),
  p(
    "La lógica del dominio y el ruteo de métodos no saben nada del transporte. Gracias a eso, el mismo código es utilizado por el servidor local sobre stdio y por el servidor remoto sobre HTTP, sin duplicarse.",
  ),
);

children.push(h2("Identidad y capacidades"));

children.push(
  table(
    ["Campo", "Valor"],
    [
      ["Nombre del servidor", "logistics-mcp"],
      ["Versión", "1.0.0"],
      ["Revisión del protocolo", "2025-06-18"],
      ["Capacidades", "Únicamente tools (sin resources, prompts ni sampling)"],
    ],
    [3, 7],
  ),
  p(""),
);

children.push(h2("Métodos implementados"));

children.push(
  table(
    ["Método", "Tipo", "Parámetros", "Resultado"],
    [
      ["initialize", "Solicitud", "protocolVersion, capabilities, clientInfo", "protocolVersion, capabilities, serverInfo"],
      ["notifications/initialized", "Notificación", "ninguno", "no lleva respuesta"],
      ["ping", "Solicitud", "ninguno", "objeto vacío"],
      ["tools/list", "Solicitud", "ninguno", "arreglo de herramientas"],
      ["tools/call", "Solicitud", "name, arguments", "content, isError"],
    ],
    [4, 2, 6, 6],
  ),
  p(""),
);

children.push(h2("Endpoints"));

children.push(
  table(
    ["Transporte", "Dirección", "Delimitación de mensajes"],
    [
      ["stdio", "node servers/logistics/stdio-server.js", "Un mensaje JSON por línea en stdin y stdout"],
      ["HTTP", "POST https://logistics-mcp.mcp-chatbot.workers.dev/mcp", "Un mensaje JSON por cuerpo de solicitud"],
      ["HTTP", "GET https://logistics-mcp.mcp-chatbot.workers.dev/health", "Verificación de estado, fuera de MCP"],
    ],
    [2, 6, 5],
  ),
  p(""),
);

children.push(
  p(
    "Sobre HTTP, una notificación se responde con el código 202 y un cuerpo vacío, porque las notificaciones no llevan respuesta. Cualquier otro mensaje se responde con 200 y un mensaje JSON-RPC, incluidos los errores de protocolo.",
  ),
);

children.push(h2("Herramientas"));

children.push(
  table(
    ["Herramienta", "Parámetros obligatorios", "Opcionales", "Devuelve"],
    [
      ["quote_shipment", "origin, destination, weight_kg", "service_level", "Precio en quetzales, días de tránsito y fecha estimada"],
      ["create_shipment", "customer, origin, destination, weight_kg", "service_level", "Número de guía, precio y sucursal de entrega"],
      ["track_shipment", "tracking_number", "—", "Estado actual e historial completo de eventos"],
      ["list_shipments", "customer", "status", "Envíos que coinciden con el filtro"],
    ],
    [4, 6, 3, 8],
  ),
  p(""),
);

children.push(
  p(
    "Las reglas del dominio son tres zonas de cobertura (metro, central y remota) que determinan la tarifa base, el costo por kilogramo y el tiempo de tránsito; tres niveles de servicio que multiplican el precio y acortan el tiempo; un límite de 70 kilogramos por paquete; y fechas de entrega calculadas en días hábiles.",
  ),
);

children.push(h2("Ejemplo de intercambio"));

children.push(
  p("Solicitud de cotización:"),
  ...code([
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{',
    '  "name":"quote_shipment",',
    '  "arguments":{"origin":"Guatemala City","destination":"Flores",',
    '               "weight_kg":8,"service_level":"express"}}}',
  ]),
  p("Respuesta:"),
  ...code([
    '{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":',
    '"Quote Guatemala City -> Flores',
    '  weight:        8 kg',
    '  service:       express',
    '  price:         GTQ 225.60',
    '  transit time:  3 business day(s)"}]}}',
  ]),
);

children.push(h2("Manejo de errores"));

children.push(
  p(
    "El servidor distingue dos tipos de falla, y esa distinción es visible en las capturas de red. Un error de protocolo significa que el mensaje en sí estuvo mal formado; un error de dominio significa que el mensaje fue correcto y la respuesta es negativa.",
  ),
  table(
    ["Situación", "Se reporta como"],
    [
      ["Método inexistente", "Error JSON-RPC, código -32601"],
      ["Cuerpo que no es JSON válido", "Error JSON-RPC, código -32700, con id nulo"],
      ["tools/call sin el parámetro name", "Error JSON-RPC, código -32602"],
      ["Número de guía inexistente", "Respuesta exitosa con isError en verdadero"],
      ["Ciudad sin cobertura o peso mayor a 70 kg", "Respuesta exitosa con isError en verdadero"],
    ],
    [5, 5],
  ),
  p(""),
);

children.push(
  p(
    "Esta decisión importa porque cambia el comportamiento del modelo. Un número de guía inexistente no es una falla del transporte, sino información que el modelo debe leer y explicarle al usuario.",
  ),
);

children.push(new Paragraph({ children: [new PageBreak()] }));

// ---------------------------------------------------------------------------
// 3. Análisis con Wireshark (requisitos 7 y 9)
// ---------------------------------------------------------------------------

children.push(h1("3. Análisis de la comunicación con Wireshark"));

children.push(
  p(
    "Se tomaron dos capturas de la misma sesión MCP contra el mismo servidor, con la única diferencia de cómo viajaron los bytes. La primera es contra el servidor desplegado en Cloudflare, sobre HTTPS, que es el escenario que pide el enunciado. La segunda es contra ese mismo servidor ejecutado localmente sin cifrado, lo que permite leer el contenido directamente y compararlo.",
  ),
  table(
    ["Captura", "Servidor", "Transporte", "Paquetes"],
    [
      ["mcp-remote-tls.pcapng", "Cloudflare Workers", "TCP/443, TLS 1.3, HTTP/1.1", "350"],
      ["mcp-local-plaintext.pcapng", "127.0.0.1:8787", "TCP/8787, HTTP/1.1 sin cifrar", "76"],
    ],
    [5, 4, 6, 2],
  ),
  p(""),
);

children.push(
  p(
    "Ambas capturas fueron generadas por el propio cliente MCP del proyecto, de modo que lo registrado es el anfitrión real conversando con el servidor real. Para poder leer el contenido de la sesión cifrada, Node exportó las claves de sesión TLS mediante la opción --tls-keylog, y ese archivo se cargó en Wireshark en las preferencias del protocolo TLS.",
  ),
);

children.push(h2("Clasificación de los mensajes JSON-RPC"));

children.push(
  p(
    "JSON-RPC 2.0 define tres formas de mensaje, y cada una se identifica en la captura por lo que contiene el objeto JSON. Una solicitud lleva method e id, y espera respuesta. Una notificación lleva method pero no lleva id, y no recibe respuesta alguna. Una respuesta lleva id junto con result o error, y se asocia a su solicitud por medio de ese id.",
  ),
);

children.push(...figure("01-mcp-descifrado.png", 620, 275, "Figura 1. Los doce mensajes MCP descifrados de la sesión contra Cloudflare, con el filtro http.request or http.response."));

children.push(
  table(
    ["Trama", "HTTP", "Clase JSON-RPC", "Detalle"],
    [
      ["91", "POST /mcp", "Solicitud", "method=initialize, id=1"],
      ["95", "200", "Respuesta", "id=1, devuelve protocolVersion y capabilities"],
      ["97", "POST /mcp", "Notificación", "method=notifications/initialized, sin id"],
      ["101", "202", "Ninguna", "Cuerpo vacío, no hay nada que responder"],
      ["107", "POST /mcp", "Solicitud", "method=tools/list, id=2"],
      ["111", "200", "Respuesta", "id=2, devuelve 4 herramientas"],
      ["113", "POST /mcp", "Solicitud", "method=tools/call, id=3"],
      ["115", "200", "Respuesta", "id=3, rastreo de GT-4471"],
      ["117", "POST /mcp", "Solicitud", "method=tools/call, id=4"],
      ["120", "200", "Respuesta", "id=4, cotización a Flores"],
      ["123", "POST /mcp", "Solicitud", "method=tools/call, id=5"],
      ["126", "200", "Respuesta", "id=5, isError por guía inexistente"],
    ],
    [2, 3, 3, 8],
  ),
  p(""),
);

children.push(h2("Cuáles son los mensajes de sincronización"));

children.push(
  p(
    "Los tres primeros mensajes forman el enlace inicial del protocolo, antes de que ocurra cualquier trabajo real. En la trama 91 el cliente anuncia la revisión del protocolo que habla, su identidad y las capacidades que ofrece. En la trama 95 el servidor responde con la revisión que va a usar y las capacidades que realmente tiene; el nuestro reporta únicamente tools.",
  ),
  p(
    "La trama 97 es la más interesante para esta pregunta. Es la notificación notifications/initialized, con la que el cliente confirma que el enlace quedó establecido, y es el único mensaje de toda la sesión que no lleva id. El servidor responde con HTTP 202 y un cuerpo vacío en la trama 101: en la capa HTTP sí regresó algo, pero en la capa JSON-RPC no regresó nada, porque una notificación no tiene respuesta por definición. Todo lo que viene después es tráfico ordinario de solicitud y respuesta.",
  ),
  p(
    "Conviene señalar también la trama 126. Al consultar el número de guía GT-9999, que no existe, la captura muestra HTTP 200 y un result de JSON-RPC, no un error. Eso es intencional: el error de dominio viaja marcado con isError dentro del resultado, mientras que el objeto error de JSON-RPC queda reservado para fallas del protocolo. La captura hace visible esa diferencia sobre el cable.",
  ),
);

children.push(new Paragraph({ children: [new PageBreak()] }));

children.push(h2("Capa de enlace"));

children.push(
  p(
    "La captura remota se tomó sobre la interfaz Wi-Fi, y las tramas son Ethernet II. La dirección MAC de origen corresponde al adaptador Realtek del equipo, 68:14:01:7a:7b:67, y la de destino es 52:d6:0d:df:fb:9c.",
  ),
  p(
    "Esa dirección de destino es la del router, no la del servidor. Las direcciones MAC solo tienen sentido dentro del segmento local: cada trama que sale de la computadora va dirigida a la puerta de enlace, que descarta la trama y construye una nueva para el siguiente salto. La identidad del servidor vive una capa más arriba. El campo EtherType es 0x86dd, que indica que el contenido es IPv6.",
  ),
  p(
    "Las tramas más grandes de la captura miden 1434 bytes, justo por debajo de la MTU de 1500 bytes de Ethernet. Ese techo es lo que obliga a que el certificado TLS, que pesa varios kilobytes, llegue repartido en varias tramas en lugar de una sola.",
  ),
);

children.push(...figure("02-handshake-tcp.png", 620, 340, "Figura 2. Saludo de tres vías de TCP y detalle de las capas de enlace y red en la trama 79."));

children.push(h2("Capa de red"));

children.push(
  p(
    "El tráfico viaja sobre IPv6. La dirección de origen es la del equipo, 2803:c800:406e:cc18:5d52:3e3b:ebe6:fbcb, y la de destino es 2606:4700:3033::6815:3f1e, dentro del rango de Cloudflare. El nombre del servidor resuelve tanto a IPv4 como a IPv6, y el sistema prefirió IPv6.",
  ),
  p(
    "La dirección de destino es una dirección anycast: ese mismo valor se anuncia desde centros de datos en todo el mundo y el enrutamiento entrega el paquete al más cercano. El servidor no está en una máquina concreta a la que se marcó, sino en el nodo de borde más próximo, y eso es lo que hace que el tiempo de ida y vuelta sea de 50 milisegundos y no de cientos.",
  ),
  p(
    "El campo de límite de saltos vale 63 en los paquetes que salen y 55 en los que regresan. Suponiendo el valor inicial habitual de 64, las respuestas atravesaron unos nueve enrutadores en el camino de vuelta. El campo de siguiente encabezado vale 6, que corresponde a TCP.",
  ),
);

children.push(h2("Capa de transporte"));

children.push(
  p(
    "La conexión se establece con el saludo de tres vías clásico de TCP, visible en las tramas 79, 80 y 81. El cliente envía SYN desde el puerto 50308 hacia el 443, el servidor responde con SYN y ACK, y el cliente confirma con ACK.",
  ),
  ...code([
    "79   3.656 s   50308 -> 443   [SYN]       ventana 64800, MSS 1440",
    "80   3.706 s   443 -> 50308   [SYN, ACK]  ventana 65535, MSS 1360",
    "81   3.707 s   50308 -> 443   [ACK]",
  ]),
  p(
    "Los 50 milisegundos que separan el SYN del SYN-ACK son el tiempo de ida y vuelta hasta el borde de Cloudflare, y establecen el piso para todo lo que ocurre encima: cada par de solicitud y respuesta MCP tardó entre 59 y 73 milisegundos. Como el propio Worker reporta un tiempo de arranque de 5 milisegundos, casi toda la latencia que percibe el usuario es red y no procesamiento.",
  ),
  p(
    "Ambos extremos anuncian tamaños máximos de segmento distintos: 1440 bytes de nuestro lado y 1360 del lado de Cloudflare. El valor menor de Cloudflare deja margen para el encapsulamiento dentro de su propia red. El tamaño efectivo es el menor de los dos.",
  ),
  p(
    "La sesión utilizó dos conexiones. La primera transportó el initialize, la notificación y las tres llamadas a herramientas; la segunda transportó únicamente el tools/list. La razón se ve en la traza: el cliente envía la notificación y de inmediato encadena el tools/list sin esperar, porque una notificación no tiene respuesta que aguardar, y como la primera conexión seguía ocupada, el cliente HTTP abrió una segunda. Las cinco solicitudes siguientes reutilizaron la primera conexión, amortizando un solo saludo de TCP y uno de TLS en toda la sesión.",
  ),
  table(
    ["Conexión", "Paquetes", "Bytes", "Duración", "Transportó"],
    [
      ["50308", "32", "15 kB", "1.17 s", "initialize, notificación y las tres llamadas"],
      ["50309", "14", "6.8 kB", "0.69 s", "tools/list"],
    ],
    [2, 2, 2, 2, 7],
  ),
  p(""),
);

children.push(new Paragraph({ children: [new PageBreak()] }));

children.push(h2("Capa de aplicación"));

children.push(
  p(
    "En esta capa se apilan tres protocolos, y la captura muestra cómo se anidan uno dentro de otro.",
  ),
  p(
    "El primero es TLS 1.3. El mensaje Client Hello de la trama 83 ofrece 52 suites de cifrado y lleva la extensión SNI en claro, con el valor logistics-mcp.mcp-chatbot.workers.dev. Ese dato viaja sin cifrar porque es justamente lo que permite a Cloudflare saber qué certificado presentar antes de que exista cifrado alguno. El Server Hello de la trama 86 selecciona la versión 1.3, la suite TLS_AES_256_GCM_SHA384 y, mediante ALPN, el protocolo HTTP/1.1.",
  ),
);

children.push(...figure("03-handshake-tls.png", 620, 375, "Figura 3. Client Hello y Server Hello de TLS 1.3. El nombre del servidor viaja legible en la extensión SNI."));

children.push(
  p(
    "A partir de la trama 92 todos los registros son de tipo Application Data. Sin el archivo de claves de sesión, el contenido JSON-RPC que va debajo resulta ilegible.",
  ),
  p(
    "El segundo protocolo es HTTP/1.1, negociado mediante ALPN. Cada mensaje MCP viaja como un POST hacia la ruta /mcp con el tipo de contenido application/json, y el cuerpo de la respuesta es la respuesta correspondiente. El código de estado HTTP se usa solo para el resultado a nivel de transporte: 200 cuando hay un mensaje JSON-RPC que devolver y 202 para una notificación que no lleva respuesta.",
  ),
  p(
    "El tercero es JSON-RPC 2.0, que viaja en el cuerpo. La siguiente figura muestra el apilamiento completo en una sola trama.",
  ),
);

children.push(...figure("04-pila-completa.png", 620, 402, "Figura 4. Trama 91 con las cinco capas visibles: Ethernet II, IPv6, TCP, TLS, HTTP y el objeto JSON."));

children.push(h2("Comparación entre la sesión cifrada y la sesión en claro"));

children.push(
  p(
    "La captura local sobre la interfaz de loopback ejecuta exactamente el mismo servidor, pero sin cifrado. El contenido JSON-RPC se lee directamente en el panel de bytes de Wireshark, sin necesidad de claves.",
  ),
);

children.push(...figure("05-loopback-claro.png", 620, 411, "Figura 5. La misma sesión sobre loopback sin cifrado. El mensaje initialize se lee en texto plano."));

children.push(
  table(
    ["Capa", "Sesión remota", "Sesión local"],
    [
      ["Enlace", "Ethernet II sobre Wi-Fi, MTU de 1500", "Loopback, sin medio físico"],
      ["Red", "IPv6 a dirección anycast, límite de saltos 63", "IPv4 de 127.0.0.1 a 127.0.0.1, TTL 128"],
      ["Transporte", "TCP puerto 443, MSS 1440 y 1360", "TCP puerto 8787, MSS 65495"],
      ["Seguridad", "TLS 1.3, se requieren claves para leer", "Ninguna, contenido legible directamente"],
      ["Tiempo de ida y vuelta", "Alrededor de 50 milisegundos", "Menos de 1 milisegundo"],
    ],
    [3, 6, 6],
  ),
  p(""),
);

children.push(
  p(
    "La diferencia más reveladora es el tamaño máximo de segmento: 65495 bytes en loopback contra 1440 sobre Wi-Fi. La interfaz de loopback nunca toca una tarjeta de red y por lo tanto no está limitada por la MTU de Ethernet, así que un mensaje JSON-RPC completo cabe en un solo segmento. Sobre la red real, ese mismo mensaje debe partirse en pedazos del tamaño de una trama Ethernet.",
  ),
  p(
    "Sin embargo, en la capa JSON-RPC las dos capturas son idénticas: las mismas cinco solicitudes, la misma notificación y las mismas respuestas asociadas por los mismos identificadores. Ese es precisamente el propósito de un modelo por capas. A MCP no le consta ni le interesa que una sesión haya cruzado el internet y la otra nunca haya salido de la máquina.",
  ),
);

children.push(new Paragraph({ children: [new PageBreak()] }));

// ---------------------------------------------------------------------------
// 4. Dificultades
// ---------------------------------------------------------------------------

children.push(h1("4. Dificultades encontradas"));

children.push(
  p(
    "Seis problemas costaron tiempo real durante el desarrollo. Todos aparecieron al probar, no al leer documentación.",
  ),
  p(
    "El primero fue que la caché de npx estaba corrupta y el servidor Filesystem oficial fallaba por una dependencia faltante. Se resolvió instalándolo como dependencia del proyecto y lanzándolo directamente con node, lo que además hizo el arranque más rápido y reproducible. El servidor Git tuvo un problema equivalente con uvx, y se resolvió instalándolo con pip.",
  ),
  p(
    "El segundo fue que el servidor Git oficial no expone ninguna herramienta para crear repositorios. Se revisaron las versiones publicadas hasta la 0.6.2 y ninguna la incluye. Por eso el repositorio de demostración se crea una sola vez durante la instalación, y todo lo demás, escribir el archivo, agregarlo y hacer el commit, sí lo maneja el chatbot.",
  ),
  p(
    "El tercero fue que un servidor que no lograba arrancar dejaba al chatbot esperando los 30 segundos completos del tiempo de espera. Detectar la salida del proceso hijo y fallar de inmediato convirtió una espera larga en un error legible al instante.",
  ),
  p(
    "El cuarto fue el más instructivo. Los modelos de razonamiento pierden el hilo si se reconstruye su turno. El código estaba armando el mensaje del asistente a partir de un formato interno propio, y eso descartaba silenciosamente campos que solo el proveedor conoce: reasoning en los modelos de Groq y thoughtSignature en Gemini 3. El primer síntoma fue que el modelo se detenía después de una llamada; el segundo fue que Gemini rechazaba la petición por completo. La solución fue guardar el mensaje del proveedor tal como llegó y reenviarlo sin tocarlo. La lección es que una abstracción que parece no perder información puede estar perdiéndola de formas que solo el otro extremo conoce.",
  ),
  p(
    "El quinto fueron los límites de las capas gratuitas. Groq permite 8000 tokens por minuto y el catálogo de herramientas, que son 30 una vez conectados todos los servidores, viaja en cada petición y cuesta alrededor de 2300 tokens cada vez. Se resolvió recortando las descripciones de las herramientas a su primera oración y reintentando automáticamente ante los códigos 429 y 503.",
  ),
  p(
    "El sexto fue que Gemini valida los esquemas de las herramientas de forma estricta y rechaza la petición completa por una palabra clave que no reconoce, y los servidores MCP oficiales emiten varias de ellas. Los esquemas se reescriben al subconjunto que Gemini acepta antes de enviarlos.",
  ),
);

// ---------------------------------------------------------------------------
// 5. Lecciones aprendidas
// ---------------------------------------------------------------------------

children.push(h1("5. Lecciones aprendidas"));

children.push(
  p(
    "El resultado más claro del proyecto es uno negativo: mover el servidor de logística desde una tubería local hasta un centro de datos de Cloudflare no requirió ningún cambio en el cliente MCP. El enlace inicial, la asociación por identificadores, el listado de herramientas y las llamadas son exactamente el mismo código en ambos casos. Lo único que se agregó fue un transporte de unas noventa líneas. Ese es el argumento completo a favor de un protocolo estándar, demostrado en lugar de afirmado.",
  ),
  p(
    "Implementar el protocolo a mano enseñó cosas que un SDK habría ocultado. Obligó a tomar decisiones que de otro modo se habrían tomado en silencio: que la delimitación sobre stdio es por saltos de línea y no por encabezados de longitud como en otros protocolos; que una notificación no lleva identificador y por lo tanto no lleva respuesta, razón por la cual el transporte HTTP debe devolver un cuerpo vacío; y que las respuestas se asocian por identificador y no por orden de llegada, que es lo que permite tener varias solicitudes en vuelo sobre una misma conexión.",
  ),
  p(
    "El modelo por capas dejó de ser algo abstracto al comparar las dos capturas. Las mismas cinco solicitudes y la misma notificación aparecen en ambas. Por debajo, una usó IPv6 hacia una dirección anycast a través de nueve enrutadores con TLS 1.3 encima, y la otra nunca salió de la máquina. MCP no notó ninguna diferencia, que es exactamente la propiedad que describen los modelos OSI y TCP/IP.",
  ),
  p(
    "También quedó claro que definir cómo se reportan los errores es una decisión de diseño y no un detalle de implementación. Decidir que un número de guía inexistente es un resultado marcado con isError, y no un error de JSON-RPC, cambia el comportamiento del modelo: lo lee y se lo explica al usuario en lugar de tratarlo como una herramienta rota. Equivocarse en eso habría sido invisible al revisar el código y evidente al conversar con el chatbot.",
  ),
  p(
    "Por último, la red domina la experiencia. Cinco milisegundos de procesamiento contra cincuenta de ida y vuelta. Cualquier cosa que reduzca viajes por la red importa mucho más que cualquier cosa que acelere el manejador.",
  ),
);

// ---------------------------------------------------------------------------
// 6. Conclusiones
// ---------------------------------------------------------------------------

children.push(h1("6. Conclusiones"));

children.push(
  p(
    "El proyecto cumplió con las diez funcionalidades requeridas. El chatbot responde con su propia base de conocimiento, mantiene el contexto a lo largo de una sesión, registra cada mensaje JSON-RPC en ambas direcciones y maneja cuatro servidores MCP: dos oficiales, uno propio y ese mismo servidor propio otra vez a través de la red.",
  ),
  p(
    "MCP resulta ser, al final, un acuerdo delgado montado sobre JSON-RPC 2.0: un enlace inicial, una forma de listar herramientas y una forma de invocarlas. Su valor no está en la sofisticación técnica sino en el hecho de que todos lo cumplen. Los servidores Filesystem y Git fueron escritos por Anthropic sin conocer este chatbot, y el servidor de logística fue escrito aquí sin conocer ningún anfitrión en particular; interoperan porque ambos lados implementan la misma especificación. Esa interoperabilidad, que el enunciado describe como el problema que MCP vino a resolver, es lo que vale la pena llevarse del proyecto.",
  ),
  p(
    "Implementarlo a mano también hizo concreto el material del curso de una forma que una biblioteca habría impedido. El initialize deja de ser una llamada a una función y pasa a ser un saludo de TCP, una negociación de TLS, una petición HTTP y un objeto JSON, cada uno visible en Wireshark como una capa distinta haciendo su propio trabajo.",
  ),
  p(
    "Quedan tres extensiones posibles. La primera es implementar resources y prompts, ya que solo se implementaron tools por ser lo que pedía el proyecto; la tabla de tarifas encajaría naturalmente como un recurso MCP. La segunda es dar persistencia al servidor remoto, cuyo estado vive en memoria y se pierde cuando la instancia se recicla; una base de datos de Cloudflare lo resolvería sin tocar la capa de protocolo. La tercera es soportar respuestas por flujo continuo, que la especificación permite para herramientas de larga duración, aunque en este caso las herramientas responden de inmediato y una respuesta JSON simple era la opción correcta.",
  ),
);

// ---------------------------------------------------------------------------

const doc = new Document({
  creator: "GenserDev",
  title: "Proyecto 1 - Uso de un protocolo existente",
  description: "Informe del Proyecto 1 de CC3067 Redes",
  styles: {
    default: {
      document: {
        run: { font: "Calibri", size: 22, color: "000000" },
      },
    },
  },
  numbering: { config: [] },
  sections: [
    {
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: 15840, orientation: PageOrientation.PORTRAIT },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  const out = path.join(DOCS, "INFORME.docx");
  fs.writeFileSync(out, buffer);
  console.log("written:", out, buffer.length, "bytes");
});
