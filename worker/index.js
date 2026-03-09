import { MongoClient } from "mongodb";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const db = await connect(env);

    // -----------------------------
    // CREATE EVENT + TICKETS
    // -----------------------------
    if (url.pathname === "/api/create-ticket" && request.method === "POST") {
      const body = await request.json();

      const event = {
        seller_id: body.seller_id,
        name: body.name,
        date: body.date,
        price: body.price,
        capacity: body.capacity,
        sold: 0,
        created_at: new Date().toISOString()
      };

      const eventRes = await db.collection("events").insertOne(event);
      const eventId = eventRes.insertedId.toString();

      const tickets = [];
      for (let i = 0; i < body.capacity; i++) {
        tickets.push({
          event_id: eventId,
          seller_id: body.seller_id,
          buyer_id: null,
          status: "active",
          qr_code_id: `qr_${eventId}_${i}`,
          purchase_at: null,
          used_at: null,
          reminder_sent: false
        });
      }

      await db.collection("tickets").insertMany(tickets);

      return json({ event_id: eventId });
    }

    // -----------------------------
    // PURCHASE TICKET
    // -----------------------------
    if (url.pathname === "/api/purchase" && request.method === "POST") {
      const body = await request.json();

      const ticket = await db.collection("tickets").findOneAndUpdate(
        { event_id: body.event_id, status: "active", buyer_id: null },
        {
          $set: {
            buyer_id: body.user_id,
            purchase_at: new Date().toISOString()
          }
        },
        { returnDocument: "after" }
      );

      if (!ticket.value) return json({ error: "No tickets available" }, 400);

      await db.collection("events").updateOne(
        { _id: ticket.value.event_id },
        { $inc: { sold: 1 } }
      );

      await db.collection("notifications").insertMany([
        {
          user_id: body.user_id,
          type: "ticket_purchase",
          message: `You bought a ticket for ${body.event_name}.`,
          created_at: new Date().toISOString(),
          read: false
        },
        {
          seller_id: ticket.value.seller_id,
          type: "ticket_sold",
          message: `You sold a ticket for ${body.event_name}.`,
          created_at: new Date().toISOString(),
          read: false
        }
      ]);

      return json({ ticket_id: ticket.value._id });
    }

    // -----------------------------
    // SCAN TICKET
    // -----------------------------
    if (url.pathname === "/api/scan" && request.method === "POST") {
      const body = await request.json();

      const ticket = await db.collection("tickets").findOne({
        qr_code_id: body.qr_code_id
      });

      if (!ticket) return json({ status: "INVALID" }, 404);
      if (ticket.status === "used") return json({ status: "ALREADY_USED" });

      await db.collection("tickets").updateOne(
        { _id: ticket._id },
        { $set: { status: "used", used_at: new Date().toISOString() } }
      );

      await db.collection("notifications").insertMany([
        {
          user_id: ticket.buyer_id,
          type: "ticket_used",
          message: "Your ticket was scanned at the door.",
          created_at: new Date().toISOString(),
          read: false
        },
        {
          seller_id: ticket.seller_id,
          type: "ticket_used",
          message: "A ticket was scanned for your event.",
          created_at: new Date().toISOString(),
          read: false
        }
      ]);

      return json({ status: "VALID" });
    }

    // -----------------------------
    // REMINDERS (CRON)
    // -----------------------------
    if (url.pathname === "/api/reminders" && request.method === "POST") {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const tickets = await db.collection("tickets").aggregate([
        {
          $match: {
            status: "active",
            buyer_id: { $ne: null },
            reminder_sent: false
          }
        },
        {
          $lookup: {
            from: "events",
            localField: "event_id",
            foreignField: "_id",
            as: "event"
          }
        }
      ]).toArray();

      const toRemind = tickets.filter(t => {
        const event = t.event[0];
        if (!event) return false;
        const eventDate = new Date(event.date);
        return eventDate.toDateString() === tomorrow.toDateString();
      });

      if (toRemind.length > 0) {
        await db.collection("notifications").insertMany(
          toRemind.map(t => ({
            user_id: t.buyer_id,
            type: "event_reminder",
            message: "Your skate event is tomorrow!",
            created_at: new Date().toISOString(),
            read: false
          }))
        );

        await db.collection("tickets").updateMany(
          { _id: { $in: toRemind.map(t => t._id) } },
          { $set: { reminder_sent: true } }
        );
      }

      return json({ reminded: toRemind.length });
    }

    return json({ error: "Not found" }, 404);
  }
};

async function connect(env) {
  const client = new MongoClient(env.MONGO_URI);
  await client.connect();
  return client.db("rollbuy");
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
