/**
 * WhatsApp Cloud API messaging helper.
 * Used server-side only — never import this in frontend code.
 */

const GRAPH_API_BASE = "https://graph.facebook.com/v22.0";

interface TextMessagePayload {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  text: {
    preview_url: boolean;
    body: string;
  };
}

export interface WhatsAppSendResponse {
  messaging_product?: string;
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string }>;
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id: string;
  };
}

/**
 * Send a plain-text WhatsApp message to a phone number (E.164 without +).
 */
export async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new Error(
      "Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID environment variables"
    );
  }

  const cleanTo = to.replace(/\D/g, "");
  const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

  const payload: TextMessagePayload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: cleanTo,
    type: "text",
    text: {
      preview_url: false,
      body: text,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `WhatsApp API error ${response.status}: ${errorBody}`
    );
  }

  const result = (await response.json()) as { messages?: Array<{ id: string }> };
  console.log(`[whatsapp] Sent message to ${cleanTo} — id: ${result.messages?.[0]?.id ?? "unknown"}`);
}

/**
 * Sends an interactive button message to a WhatsApp user via Meta Cloud API.
 * WhatsApp supports a maximum of 3 reply buttons, each title max 20 characters.
 */
export async function sendWhatsAppButtons(
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>
): Promise<WhatsAppSendResponse> {
  const token = process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new Error(
      "[whatsapp] Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID in environment"
    );
  }

  const cleanTo = to.replace(/\D/g, "");
  const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

  // WhatsApp allows maximum 3 buttons, each title <= 20 chars
  const validButtons = buttons.slice(0, 3).map((b) => ({
    type: "reply",
    reply: {
      id: b.id,
      title: b.title.length > 20 ? b.title.slice(0, 17) + "..." : b.title,
    },
  }));

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: cleanTo,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: bodyText,
      },
      action: {
        buttons: validButtons,
      },
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as WhatsAppSendResponse;

  if (!response.ok) {
    console.error("[whatsapp] Error sending interactive buttons:", JSON.stringify(data));
    throw new Error(
      `Meta API error ${response.status}: ${data.error?.message || "Unknown error"}`
    );
  }

  console.log(`[whatsapp] Interactive buttons sent successfully to ${cleanTo}`);
  return data;
}

/**
 * Sends an interactive list message to a WhatsApp user via Meta Cloud API.
 * WhatsApp allows up to 10 list rows per section, with titles up to 24 characters.
 */
export async function sendWhatsAppList(
  to: string,
  bodyText: string,
  buttonLabel: string,
  items: Array<{ id: string; title: string; description?: string }>
): Promise<WhatsAppSendResponse> {
  const token = process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new Error(
      "[whatsapp] Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID in environment"
    );
  }

  const cleanTo = to.replace(/\D/g, "");
  const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

  // WhatsApp allows up to 10 rows in a list section, each title <= 24 chars
  const validRows = items.slice(0, 10).map((item) => ({
    id: item.id,
    title: item.title.length > 24 ? item.title.slice(0, 21) + "..." : item.title,
    ...(item.description ? { description: item.description.slice(0, 72) } : {}),
  }));

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: cleanTo,
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text: bodyText,
      },
      action: {
        button: buttonLabel.length > 20 ? buttonLabel.slice(0, 20) : buttonLabel,
        sections: [
          {
            title: "Accounts",
            rows: validRows,
          },
        ],
      },
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as WhatsAppSendResponse;

  if (!response.ok) {
    console.error("[whatsapp] Error sending interactive list:", JSON.stringify(data));
    throw new Error(
      `Meta API error ${response.status}: ${data.error?.message || "Unknown error"}`
    );
  }

  console.log(`[whatsapp] Interactive list sent successfully to ${cleanTo}`);
  return data;
}
