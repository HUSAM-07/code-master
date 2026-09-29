import { appEnv } from "@/lib/env";
import { authed } from "@/lib/http";

export async function POST(request: Request) {
  return authed(appEnv, request, async (user) => {
    const account = await appEnv.DB.prepare(
      "SELECT dodo_customer_id FROM users WHERE id=?",
    )
      .bind(user.id)
      .first<{ dodo_customer_id: string | null }>();
    if (!appEnv.DODO_API_KEY || !account?.dodo_customer_id || !["test", "live"].includes(appEnv.DODO_MODE || ""))
      throw new Response("No billing account found", { status: 404 });
    const response = await fetch(
      `https://${appEnv.DODO_MODE}.dodopayments.com/customers/${encodeURIComponent(account.dodo_customer_id)}/customer-portal/session?${new URLSearchParams({ return_url: new URL(request.url).origin })}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appEnv.DODO_API_KEY}`,
        },
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok)
      throw new Error(`Dodo portal failed (${response.status})`);
    const data = (await response.json()) as { link?: string };
    if (!data.link) throw new Error("Dodo returned no portal link");
    return Response.json({ url: data.link });
  });
}
