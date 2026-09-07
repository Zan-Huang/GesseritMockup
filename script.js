const form = document.querySelector(".subscribe");
const field = document.querySelector(".subscribe__field");
const note = document.querySelector(".subscribe__note");

// The form posts straight to Substack, but into a hidden iframe so the reader
// stays on the page. That also sidesteps CORS, at the cost of not being able to
// read the response, so the confirmation here reports what we sent, not what
// Substack decided.
function say(message, ok) {
  if (!note) return;
  note.textContent = message;
  note.classList.toggle("subscribe__note--ok", Boolean(ok));
}

if (form && field) {
  const origin = window.location.href;
  const referrer = document.referrer || "";
  const set = (name, value) => {
    const input = form.querySelector(`input[name="${name}"]`);
    if (input) input.value = value;
  };
  set("current_url", origin);
  set("first_url", origin);
  set("current_referrer", referrer);
  set("first_referrer", referrer);

  form.addEventListener("submit", (event) => {
    if (!field.value.trim() || !field.checkValidity()) {
      event.preventDefault();
      say("Please enter a valid email address.", false);
      field.focus();
      return;
    }
    say("Thanks — check your inbox to confirm.", true);
    // The browser serialises the form after this handler returns, so clearing
    // the field here would post an empty address. Wait for the post to leave.
    window.setTimeout(() => {
      field.value = "";
    }, 600);
  });
}
