/* ===========================
   ROLL BUY — APP.JS
   Navigation • Polling • Notifications
=========================== */

console.log("Roll Buy App Loaded");

/* ===========================
   SIMPLE NAVIGATION
=========================== */

function go(page) {
  window.location.href = page;
}

/* ===========================
   POPUP NOTIFICATION
=========================== */

function showPopup(message) {
  const popup = document.getElementById("popup");
  popup.innerText = message;
  popup.classList.add("show");

  setTimeout(() => {
    popup.classList.remove("show");
  }, 3500);
}

/* ===========================
   POLL FOR NEW NOTIFICATIONS
=========================== */

async function pollNotifications(userId) {
  try {
    const res = await fetch(`./data/users/${userId}/notifications.json?cache=${Date.now()}`);
    const data = await res.json();

    const unread = data.filter(n => n.read === false);

    const dot = document.getElementById("notifDot");
    if (unread.length > 0) {
      dot.style.display = "block";
      showPopup(unread[0].message);
    } else {
      dot.style.display = "none";
    }

  } catch (err) {
    console.error("Notification polling failed:", err);
  }
}

/* ===========================
   START POLLING
=========================== */

function startPolling(userId) {
  pollNotifications(userId);
  setInterval(() => pollNotifications(userId), 15000);
}
