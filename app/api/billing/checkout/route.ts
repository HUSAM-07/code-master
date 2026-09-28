import { appEnv } from "@/lib/env";
import { authed } from "@/lib/http";

export async function POST(request: Request) {
  return authed(appEnv, request, async (user) => {
    if (!appEnv.STRIPE_SECRET_KEY || !appEnv.STRIPE_PRICE_ID)
      throw new Response("Billing is not configured yet", { status: 503 });
    const origin = new URL(request.url).origin;
    const params = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": appEnv.STRIPE_PRICE_ID,
      "line_items[0][quantity]": "1",
      client_reference_id: user.id,
      success_url: `${origin}/?billing=success`,
      cancel_url: `${origin}/?billing=cancelled`,
    });
    const response = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appEnv.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok)
      throw new Error(`Stripe checkout failed (${response.status})`);
    const data = (await response.json()) as { url?: string };
    if (!data.url) throw new Error("Stripe returned no checkout URL");
    return Response.json({ url: data.url });
  });
}
