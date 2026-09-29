import { appEnv } from "@/lib/env";
import { authed } from "@/lib/http";

export async function POST(request: Request) {
  return authed(appEnv, request, async (user) => {
    if (!appEnv.DODO_API_KEY || !appEnv.DODO_PRODUCT_ID || !["test", "live"].includes(appEnv.DODO_MODE || ""))
      throw new Response("Billing is not configured yet", { status: 503 });
    const origin = new URL(request.url).origin;
    const response = await fetch(
      `https://${appEnv.DODO_MODE}.dodopayments.com/checkouts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appEnv.DODO_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          product_cart: [{ product_id: appEnv.DODO_PRODUCT_ID, quantity: 1 }],
          metadata: { foundry_user_id: user.id },
          return_url: `${origin}/?billing=success`,
          cancel_url: `${origin}/?billing=cancelled`,
        }),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok)
      throw new Error(`Dodo checkout failed (${response.status})`);
    const data = (await response.json()) as { checkout_url?: string };
    if (!data.checkout_url) throw new Error("Dodo returned no checkout URL");
    return Response.json({ url: data.checkout_url });
  });
}
