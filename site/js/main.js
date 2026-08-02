// Mobile menu toggle
document.addEventListener("DOMContentLoaded", () => {
  const menuBtn = document.getElementById("menu-btn");
  const mobileMenu = document.getElementById("mobile-menu");
  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener("click", () => {
      mobileMenu.classList.toggle("open");
      const icon = menuBtn.querySelector("svg");
      if (mobileMenu.classList.contains("open")) {
        icon.innerHTML =
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>';
      } else {
        icon.innerHTML =
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>';
      }
    });
  }

  // Copy buttons
  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.closest(".code-block").querySelector("code").textContent;
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => {
          btn.textContent = "Copy";
        }, 2000);
      });
    });
  });

  // Scroll reveal
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
        }
      });
    },
    { threshold: 0.1 },
  );

  document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));

  // Active nav link
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-link").forEach((link) => {
    const href = link.getAttribute("href");
    if (href === currentPage || (currentPage === "" && href === "index.html")) {
      link.classList.add("active");
    }
  });

  // Example expand/collapse
  document.querySelectorAll(".example-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const content = btn.closest(".example-item").querySelector(".example-content");
      const arrow = btn.querySelector(".arrow");
      content.classList.toggle("open");
      if (arrow) {
        arrow.style.transform = content.classList.contains("open") ? "rotate(180deg)" : "";
      }
    });
  });

  // Tab switching
  document.querySelectorAll("[data-tab-group]").forEach((group) => {
    const btns = group.querySelectorAll(".tab-btn");
    btns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.tab;
        const groupName = group.dataset.tabGroup;
        btns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll(`[data-tab-content="${groupName}"]`).forEach((panel) => {
          panel.style.display = panel.dataset.tabId === target ? "" : "none";
        });
      });
    });
  });
});
