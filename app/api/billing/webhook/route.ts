import { Webhook } from "standardwebhooks";
import { appEnv } from "@/lib/env";
import { rawBody } from "@/lib/http";
import { jsonError } from "@/lib/security";

type SubscriptionEvent = {
  type: string;
  timestamp: string;
  data?: {
    subscription_id?: string;
    product_id?: string;
    status?: string;
    past_due_ends_at?: string | null;
    customer?: { customer_id?: string };
    metadata?: { foundry_user_id?: string };
  };
};

export async function POST(request: Request) {
  if (!appEnv.DODO_WEBHOOK_KEY || !appEnv.DODO_PRODUCT_ID)
    return new Response("Billing is not configured", { status: 503 });
  try {
    const raw = await rawBody(request);
    let event: SubscriptionEvent;
    try {
      event = new Webhook(appEnv.DODO_WEBHOOK_KEY).verify(raw, {
        "webhook-id": request.headers.get("webhook-id") || "",
        "webhook-signature": request.headers.get("webhook-signature") || "",
        "webhook-timestamp": request.headers.get("webhook-timestamp") || "",
      }) as SubscriptionEvent;
    } catch {
      return new Response("Invalid signature", { status: 400 });
    }
    if (!event?.type?.startsWith("subscription."))
      return Response.json({ received: true });
    const data = event.data;
    const eventAt = Date.parse(event.timestamp);
    if (!data?.subscription_id || !data.customer?.customer_id || !Number.isFinite(eventAt))
      return new Response("Invalid subscription event", { status: 400 });
    const userId = data.metadata?.foundry_user_id ||
      (await appEnv.DB.prepare("SELECT id FROM users WHERE dodo_subscription_id=?")
        .bind(data.subscription_id)
        .first<{ id: string }>())?.id;
    if (!userId) return Response.json({ received: true });
    const pro = data.product_id === appEnv.DODO_PRODUCT_ID &&
      (data.status === "active" ||
        (data.status === "past_due" && Date.parse(data.past_due_ends_at || "") > Date.now()));
    const plan = pro ? "pro" : "free";
    await appEnv.DB.prepare(
      "UPDATE users SET dodo_customer_id=?,dodo_subscription_id=?,dodo_event_at=?,plan=? WHERE id=? AND (dodo_event_at IS NULL OR dodo_event_at<=?) AND (dodo_subscription_id IS NULL OR dodo_subscription_id=? OR ?='pro')",
    ).bind(data.customer.customer_id, data.subscription_id, eventAt, plan, userId, eventAt, data.subscription_id, plan).run();
    return Response.json({ received: true });
  } catch (error) {
    return jsonError(error);
  }
}
