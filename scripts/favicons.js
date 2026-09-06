document.querySelectorAll('a[href^="https://"]').forEach((link) => {
  const icon = document.createElement("img");
  icon.className = "favicon";
  icon.alt = "";
  icon.width = 16;
  icon.height = 16;
  icon.referrerPolicy = "no-referrer";
  icon.addEventListener("error", () => icon.remove(), { once: true });
  icon.src = `https://icon.horse/icon/${new URL(link.href).hostname}`;
  link.prepend(icon);
});
