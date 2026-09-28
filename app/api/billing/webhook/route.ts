import { appEnv } from "@/lib/env";

export async function POST(request: Request) {
  const secret = appEnv.STRIPE_WEBHOOK_SECRET;
  const header = request.headers.get("stripe-signature") || "";
  if (!secret)
    return new Response("Billing is not configured", { status: 503 });
  const parts = header.split(",").map((part) => part.trim().split("=", 2));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  if (
    !Number.isFinite(timestamp) ||
    Math.abs(Date.now() / 1000 - timestamp) > 300
  )
    return new Response("Invalid signature", { status: 400 });
  const raw = await request.text();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${raw}`),
    ),
  );
  const expected = Array.from(signed, (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const signatures = parts
    .filter(([key, value]) => key === "v1" && /^[a-f0-9]{64}$/i.test(value || ""))
    .map(([, value]) => value);
  if (!signatures.some((signature) => {
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++)
      mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    return mismatch === 0;
  })) return new Response("Invalid signature", { status: 400 });
  const event = JSON.parse(raw) as {
    type: string;
    data: {
      object: {
        client_reference_id?: string;
        customer?: string;
        status?: string;
        payment_status?: string;
      };
    };
  };
  const object = event.data.object;
  if (
    event.type === "checkout.session.completed" &&
    object.client_reference_id &&
    object.customer
  ) {
    await appEnv.DB.prepare(
      "UPDATE users SET stripe_customer_id=?,plan=CASE WHEN ? IN ('paid','no_payment_required') THEN 'pro' ELSE plan END WHERE id=?",
    )
      .bind(
        object.customer,
        object.payment_status || "",
        object.client_reference_id,
      )
      .run();
  }
  if (
    [
      "customer.subscription.created",
      "customer.subscription.deleted",
      "customer.subscription.updated",
    ].includes(event.type) &&
    object.customer
  ) {
    await appEnv.DB.prepare(
      "UPDATE users SET plan=? WHERE stripe_customer_id=?",
    )
      .bind(
        event.type === "customer.subscription.deleted" ||
          !["active", "trialing"].includes(object.status || "")
          ? "free"
          : "pro",
        object.customer,
      )
      .run();
  }
  return Response.json({ received: true });
}
