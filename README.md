# Bot de WhatsApp - Aserfiplan

Asistente virtual que atiende a los clientes por WhatsApp (compra de inmuebles, seguros y organización financiera), responde con botones y agenda reuniones en Google Meet. Todo con servicios gratuitos (con límites): Gemini, Google Calendar y Gmail.

## Cómo funciona

1. Un cliente escribe al WhatsApp del negocio.
2. Meta envía el mensaje a este programa (ruta `/webhook`).
3. El programa lo filtra (solo mensajes al número del negocio) y se lo pasa a Gemini, que recuerda la conversación de cada cliente.
4. Gemini responde, y cuando el cliente quiere una reunión, consulta tu Google Calendar, crea el evento con enlace de Meet y te avisa por correo.
5. La respuesta vuelve al cliente por WhatsApp, con botones si aplica.

## Qué necesitas

- Node.js 20 o superior (https://nodejs.org)
- Una app de WhatsApp Business API en Meta (developers.facebook.com)
- Una cuenta de Google (para Gemini, Calendar y Gmail)

## 1. Instalar

```bash
git clone https://github.com/andres0256/aserfiplan-.git
cd aserfiplan-
npm install
cp .env.example .env     # en Windows: copy .env.example .env
```

Luego abre el archivo `.env` y llena cada valor (paso 2).

## 2. Conseguir las credenciales

**WhatsApp (Meta)**
- `WA_PHONE_ID`: en tu app de Meta, WhatsApp > Configuración de la API, "Identificador del número de teléfono".
- `WA_TOKEN`: el token temporal dura solo 24 horas. Para producción crea uno permanente: Meta Business > Configuración > Usuarios del sistema > crear usuario > asignar la app > generar token con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
- `WA_VERIFY_TOKEN`: invéntalo tú (cualquier palabra secreta). Lo usarás en el paso 4.
- `BUSINESS_NUMBER`: el número del negocio, solo dígitos con el indicativo (ejemplo `573013422266`).

**Gemini (IA gratis)**
- Entra a https://aistudio.google.com, crea una API key y pónla en `GEMINI_API_KEY`.
- Revisa en AI Studio cuál es el modelo gratuito vigente y ponlo en `GEMINI_MODEL`. La capa gratis tiene límites de mensajes por minuto y por día.

**Google Calendar y Meet**
1. Entra a https://console.cloud.google.com y crea un proyecto.
2. Activa la "Google Calendar API".
3. Configura la pantalla de consentimiento OAuth y **publícala en modo "En producción"**. Si la dejas en modo de prueba, el token vence a los 7 días y el bot deja de agendar.
4. Crea unas credenciales "ID de cliente OAuth" de tipo "Aplicación web" y agrega como URI de redirección `https://developers.google.com/oauthplayground`. Copia el ID y el secreto en `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.
5. Entra a https://developers.google.com/oauthplayground, pulsa la rueda de configuración, marca "Use your own OAuth credentials" y pega tu ID y secreto.
6. En el paso 1 del Playground escribe el permiso `https://www.googleapis.com/auth/calendar`, autoriza con la cuenta cuyo calendario se va a usar, y en el paso 2 pulsa "Exchange authorization code for tokens". Copia el "Refresh token" en `GOOGLE_REFRESH_TOKEN`.

**Correo (aviso de cada reunión)**
- Activa la verificación en dos pasos en la cuenta de Gmail y crea una "contraseña de aplicación" en https://myaccount.google.com/apppasswords.
- `GMAIL_USER`: la cuenta que envía. `GMAIL_APP_PASSWORD`: la contraseña de 16 letras. `OWNER_EMAIL`: el correo del asesor que recibe los avisos.

## 3. Ejecutar

```bash
npm start
```

Debe aparecer: `Bot de Aserfiplan listo en el puerto 3000`.

## 4. Conectar con WhatsApp

Meta necesita una dirección pública con HTTPS.

- **Para probar en tu computador:** instala ngrok (https://ngrok.com) y ejecuta `ngrok http 3000`. Te da una dirección como `https://abc123.ngrok-free.app`.
- **Para producción (el cliente real):** sube el bot a un servidor que esté prendido siempre, por ejemplo Oracle Cloud (plan "Always Free") o un VPS económico. Los planes gratis de otros servicios suelen "dormir" el programa y tardan en responder.

Luego, en tu app de Meta: WhatsApp > Configuración > Webhook:
- URL de devolución de llamada: `https://TU-DIRECCION/webhook`
- Token de verificación: el mismo valor de `WA_VERIFY_TOKEN`
- Pulsa "Verificar y guardar" y suscríbete al campo **messages**.

## 5. Probar

Escribe "Hola" al WhatsApp del negocio desde otro celular. Si tu app de Meta está en modo desarrollo, primero agrega ese celular como número de prueba.

## Personalizar

Todo el comportamiento del asistente está en el texto de `systemPrompt` dentro de `index.js`: servicios, tono, reglas y cuándo ofrecer botones. Agrega ahí datos reales (ciudades de los lotes, horarios de atención, requisitos) para que no tenga que inventarlos.

## Límites a tener en cuenta

- La memoria de las conversaciones vive en la RAM: si reinicias el programa, los clientes empiezan de cero.
- WhatsApp solo permite responder libremente dentro de las 24 horas siguientes al último mensaje del cliente. Los mensajes que inicia el negocio fuera de esa ventana requieren plantillas aprobadas y pueden tener costo según las tarifas vigentes de Meta.
- Los botones de WhatsApp admiten máximo 3 opciones de 20 caracteres.
- Nunca subas el archivo `.env` a GitHub (ya está en `.gitignore`).

## Problemas frecuentes

- **Meta no verifica el webhook:** revisa que `WA_VERIFY_TOKEN` sea idéntico en el `.env` y en Meta, y que la URL termine en `/webhook`.
- **El bot no responde:** mira la consola donde corre el programa; ahí aparece el error. Revisa también que `BUSINESS_NUMBER` coincida con el número que recibe los mensajes.
- **Error 401 al responder:** el token de WhatsApp venció (el temporal dura 24 horas).
- **No agenda reuniones:** revisa que la app de Google esté en modo "En producción" y que el refresh token sea reciente.
