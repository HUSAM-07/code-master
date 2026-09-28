import { appEnv } from "@/lib/env";
import { authed } from "@/lib/http";

export async function POST(request: Request) {
  return authed(appEnv, request, async (user) => {
    const account = await appEnv.DB.prepare(
      "SELECT stripe_customer_id FROM users WHERE id=?",
    )
      .bind(user.id)
      .first<{ stripe_customer_id: string | null }>();
    if (!appEnv.STRIPE_SECRET_KEY || !account?.stripe_customer_id)
      throw new Response("No billing account found", { status: 404 });
    const response = await fetch(
      "https://api.stripe.com/v1/billing_portal/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appEnv.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          customer: account.stripe_customer_id,
          return_url: new URL(request.url).origin,
        }),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok)
      throw new Error(`Stripe portal failed (${response.status})`);
    const data = (await response.json()) as { url: string };
    return Response.json({ url: data.url });
  });
}
