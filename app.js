
"use strict";

const $ = (id) => document.getElementById(id);
const DB_KEY = "closetInventory.items.v1";
const DB_NAME = "ClosetInventoryDB";
const DB_STORE = "items";

let items = [];
let currentFilter = "Available";
let currentCategory = "All";
let currentView = "inventory";
let currentItemId = null;
let selectedPhoto = null;
let toastTimer;

const supportsIndexedDB = "indexedDB" in window;
let dbPromise = null;

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() :
    Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function money(value) {
  return "TZS " + Number(value || 0).toLocaleString("en-TZ");
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[char]);
}

function showToast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2600);
}

function openDatabase() {
  if (!supportsIndexedDB) return Promise.reject(new Error("IndexedDB unavailable"));
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function loadItems() {
  try {
    const db = await openDatabase();
    items = await new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, "readonly")
        .objectStore(DB_STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    // One-time migration of records from the earlier localStorage version.
    const old = localStorage.getItem(DB_KEY);
    if (old && items.length === 0) {
      try {
        const previousItems = JSON.parse(old);
        if (Array.isArray(previousItems)) {
          const transaction = db.transaction(DB_STORE, "readwrite");
          previousItems.forEach(item => transaction.objectStore(DB_STORE).put(item));
          await new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
          });
          items = previousItems;
        }
        localStorage.removeItem(DB_KEY);
      } catch (error) {
        console.warn("Could not migrate old inventory", error);
      }
    }
  } catch (error) {
    console.error(error);
    try {
      items = JSON.parse(localStorage.getItem(DB_KEY) || "[]");
      if (!Array.isArray(items)) items = [];
    } catch {
      items = [];
    }
    showToast("Browser storage is limited. Export backups regularly.");
  }
  renderInventory();
}

async function persistItems() {
  try {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, "readwrite");
      const store = transaction.objectStore(DB_STORE);
     store.clear();
     items.forEach(item => store.put(item));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    console.error("Saving inventory failed", error);
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(items));
    } catch {
      showToast("Storage is full. Export a backup and reduce photo sizes.");
    }
  }
}

function statusClass(status) {
  return status === "Sold" ? "status-sold" : "status-available";
}

function photoMarkup(item, extraClass = "") {
  return item.photo
    ? `<img class="${extraClass}" src="${escapeHTML(item.photo)}" alt="${escapeHTML(item.name)}">`
    : `<div class="photo-placeholder-art ${extraClass}" role="img" aria-label="No photo">✳</div>`;
}

function renderInventory() {
  $("totalCount").textContent = items.length;
  $("availableCount").textContent = items.filter(item => item.status === "Available").length;
  $("soldCount").textContent = items.filter(item => item.status === "Sold").length;

  document.querySelectorAll("[data-filter]").forEach(button => {
    button.classList.toggle("active", button.dataset.filter === currentFilter);
  });
  document.querySelectorAll("[data-category]").forEach(button => {
    button.classList.toggle("active", button.dataset.category === currentCategory);
  });

  const filtered = items.filter(item =>
    (currentFilter === "All" || item.status === currentFilter) &&
    (currentCategory === "All" || item.category === currentCategory)
  );

  $("resultCount").textContent = `${filtered.length} ${filtered.length === 1 ? "item" : "items"}`;
  $("emptyState").classList.toggle("hidden", filtered.length > 0);
  $("inventoryGrid").innerHTML = filtered.map(item => `
    <article class="item-card">
      <button class="item-open" data-open="${escapeHTML(item.id)}" aria-label="View ${escapeHTML(item.name)}">
        <div class="item-photo-wrap">
          ${photoMarkup(item, "item-photo")}
          <span class="status-badge ${statusClass(item.status)}">${escapeHTML(item.status)}</span>
        </div>
        <div class="item-info">
          <h3>${escapeHTML(item.name)}</h3>
          <p class="item-price">${money(item.price)}</p>
          <p class="item-meta">${escapeHTML(item.category)} · Size ${escapeHTML(item.size)} · Qty ${Number(item.quantity) || 1}</p>
        </div>
      </button>
      <div class="item-actions">
        <button data-edit="${escapeHTML(item.id)}">Edit</button>
        <button class="sold-action" data-toggle="${escapeHTML(item.id)}">${item.status === "Sold" ? "Mark available" : "Mark sold"}</button>
      </div>
    </article>
  `).join("");

  $("navSold").classList.toggle("active", currentFilter === "Sold");
}

function showView(view) {
  currentView = view;
  $("inventoryScreen").classList.toggle("hidden", view !== "inventory");
  $("detailsScreen").classList.toggle("hidden", view !== "details");
  $("addScreen").classList.toggle("hidden", view !== "add");

  document.querySelectorAll(".nav-button").forEach(button => {
    button.classList.toggle("active",
      button.dataset.view === view ||
      (button.id === "navSold" && view === "inventory" && currentFilter === "Sold"));
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  $("itemForm").reset();
  $("itemId").value = "";
  $("formTitle").textContent = "Add a new piece";
  $("photoInput").value = "";
  $("photoPreview").src = "";
  $("photoPreview").classList.add("hidden");
  $("photoPlaceholder").classList.remove("hidden");
  $("removePhotoButton").classList.add("hidden");
  selectedPhoto = null;
  currentItemId = null;
}

function addNewItem() {
  resetForm();
  showView("add");
}

function editItem(id) {
  const item = items.find(entry => entry.id === id);
  if (!item) return;

  resetForm();
  currentItemId = id;
  $("itemId").value = id;
  $("formTitle").textContent = "Edit your piece";
  $("itemName").value = item.name;
  $("itemPrice").value = item.price;
  $("itemCategory").value = item.category;
  $("itemSize").value = item.size;
  $("itemQuantity").value = item.quantity;
  $("itemStatus").value = item.status;
  $("itemNotes").value = item.notes || "";
  selectedPhoto = item.photo || null;

  if (selectedPhoto) showPhotoPreview(selectedPhoto);
  showView("add");
}

function showPhotoPreview(dataUrl) {
  $("photoPreview").src = dataUrl;
  $("photoPreview").classList.remove("hidden");
  $("photoPlaceholder").classList.add("hidden");
  $("removePhotoButton").classList.remove("hidden");
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("That image could not be opened."));
      image.onload = () => {
        const maxDimension = 1100;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function saveItem(event) {
  event.preventDefault();

  const name = $("itemName").value.trim();
  const price = Number($("itemPrice").value);
  const quantity = Number($("itemQuantity").value);

  if (!name || !Number.isFinite(price) || price < 0 ||
      !Number.isInteger(quantity) || quantity < 1) {
    showToast("Check the item name, price and quantity.");
    return;
  }

  const previous = items.find(item => item.id === currentItemId);
  const item = {
    id: currentItemId || makeId(),
    name,
    price,
    category: $("itemCategory").value,
    size: $("itemSize").value,
    quantity,
    status: $("itemStatus").value,
    notes: $("itemNotes").value.trim(),
    photo: selectedPhoto || null,
    dateAdded: previous?.dateAdded || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const existingIndex = items.findIndex(entry => entry.id === item.id);
  if (existingIndex >= 0) items[existingIndex] = item;
  else items.unshift(item);

  await persistItems();
  renderInventory();
  showView("inventory");
  showToast(existingIndex >= 0 ? "Item updated." : "Item added to your collection.");
  resetForm();
}

function showDetails(id) {
  const item = items.find(entry => entry.id === id);
  if (!item) return;
  currentItemId = id;

  $("detailsContent").innerHTML = `
    <div class="detail-hero">
      <div class="detail-photo-wrap">${photoMarkup(item, "detail-photo")}</div>
      <div class="detail-copy">
        <span class="status-badge ${statusClass(item.status)}">${escapeHTML(item.status)}</span>
        <h2>${escapeHTML(item.name)}</h2>
        <p class="detail-price">${money(item.price)}</p>
        <p class="detail-description">${escapeHTML(item.notes || "No additional notes for this item.")}</p>
        <div class="detail-list">
          <div class="detail-row"><span>Category</span><span>${escapeHTML(item.category)}</span></div>
          <div class="detail-row"><span>Size</span><span>${escapeHTML(item.size)}</span></div>
          <div class="detail-row"><span>Quantity</span><span>${Number(item.quantity) || 1}</span></div>
          <div class="detail-row"><span>Date added</span><span>${new Date(item.dateAdded).toLocaleDateString()}</span></div>
        </div>
        <div class="detail-actions">
          <button class="primary-button" data-edit="${escapeHTML(item.id)}">Edit item</button>
          <button class="secondary-button" data-toggle="${escapeHTML(item.id)}">${item.status === "Sold" ? "Mark available" : "Mark sold"}</button>
        </div>
        <button class="text-button" data-delete="${escapeHTML(item.id)}">Delete this item</button>
      </div>
    </div>
  `;
  showView("details");
}

async function toggleStatus(id) {
  const item = items.find(entry => entry.id === id);
  if (!item) return;
  item.status = item.status === "Sold" ? "Available" : "Sold";
  item.updatedAt = new Date().toISOString();
  await persistItems();
  renderInventory();
  if (currentView === "details") showDetails(id);
  showToast(`Marked ${item.name} as ${item.status.toLowerCase()}.`);
}

async function deleteItem(id) {
  const item = items.find(entry => entry.id === id);
  if (!item) return;
  if (!confirm(`Delete "${item.name}" permanently from this device?`)) return;
  items = items.filter(entry => entry.id !== id);
  await persistItems();
  renderInventory();
  showView("inventory");
  showToast("Item deleted.");
}

function exportBackup() {
  const blob = new Blob([JSON.stringify({
    app: "ClosetInventory",
    version: 1,
    exportedAt: new Date().toISOString(),
    items
  }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `closet-inventory-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Backup export started.");
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onerror = () => showToast("Could not read that backup file.");
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      const imported = Array.isArray(parsed) ? parsed : parsed.items;
      if (!Array.isArray(imported)) throw new Error("Invalid backup");

      const valid = imported.filter(item =>
        item && typeof item.name === "string" &&
        Number.isFinite(Number(item.price)) &&
        ["Available", "Sold"].includes(item.status)
      );

      if (!valid.length && imported.length) throw new Error("No valid records");
      if (!confirm(`Import ${valid.length} items? This replaces the inventory currently on this device.`)) return;

      items = valid.map(item => ({
        id: String(item.id || makeId()),
        name: item.name.slice(0,100),
        price: Math.max(0, Number(item.price)),
        category: String(item.category || "Other"),
        size: String(item.size || "Not specified"),
        quantity: Math.max(1, Number(item.quantity) || 1),
        status: item.status,
        notes: String(item.notes || ""),
        photo: typeof item.photo === "string" ? item.photo : null,
        dateAdded: item.dateAdded || new Date().toISOString(),
        updatedAt: item.updatedAt || new Date().toISOString()
      }));
      await persistItems();
      renderInventory();
      showView("inventory");
      showToast("Backup restored.");
    } catch {
      showToast("That backup file is not valid.");
    }
  };
  reader.readAsText(file);
}

document.addEventListener("click", event => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    if (viewButton.dataset.view === "add") addNewItem();
    else showView(viewButton.dataset.view);
    return;
  }

  const filterButton = event.target.closest("[data-filter]");
  if (filterButton) {
    currentFilter = filterButton.dataset.filter;
    renderInventory();
    return;
  }

  const categoryButton = event.target.closest("[data-category]");
  if (categoryButton) {
    currentCategory = categoryButton.dataset.category;
    renderInventory();
    return;
  }

  const openButton = event.target.closest("[data-open]");
  if (openButton) return showDetails(openButton.dataset.open);

  const editButton = event.target.closest("[data-edit]");
  if (editButton) return editItem(editButton.dataset.edit);

  const toggleButton = event.target.closest("[data-toggle]");
  if (toggleButton) return toggleStatus(toggleButton.dataset.toggle);

  const deleteButton = event.target.closest("[data-delete]");
  if (deleteButton) return deleteItem(deleteButton.dataset.delete);
});

$("itemForm").addEventListener("submit", saveItem);

$("photoInput").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    selectedPhoto = await resizeImage(file);
    showPhotoPreview(selectedPhoto);
  } catch (error) {
    showToast(error.message || "Could not use that photo.");
    event.target.value = "";
  }
});

$("removePhotoButton").addEventListener("click", () => {
  selectedPhoto = null;
  $("photoInput").value = "";
  $("photoPreview").src = "";
  $("photoPreview").classList.add("hidden");
  $("photoPlaceholder").classList.remove("hidden");
  $("removePhotoButton").classList.add("hidden");
});

$("backupButton").addEventListener("click", () => {
  if (confirm("Choose OK to export a backup, or Cancel to import a backup instead.")) {
    exportBackup();
  } else {
    $("importInput").click();
  }
});

$("importInput").addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (file) importBackup(file);
  event.target.value = "";
});

$("navSold").addEventListener("click", () => {
  currentFilter = "Sold";
  currentCategory = "All";
  renderInventory();
  showView("inventory");
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(error =>
      console.warn("Offline support could not be registered:", error)
    );
  });
}

loadItems();
