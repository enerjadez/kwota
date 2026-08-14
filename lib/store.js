import fs from "fs";
import path from "path";
import { nid, nowIso } from "./util.js";

export function createStore(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  let data = { businesses: [], quotes: [], sessions: [] };
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      data = {
        businesses: parsed.businesses || [],
        quotes: parsed.quotes || [],
        sessions: parsed.sessions || [],
      };
    } catch {
      const bak = filePath + ".corrupt." + Date.now();
      try {
        fs.copyFileSync(filePath, bak);
      } catch {
        /* ignore */
      }
    }
  }

  function save() {
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* first write */
    }
    fs.renameSync(tmp, filePath);
  }

  function pruneSessions() {
    const t = Date.now();
    const before = data.sessions.length;
    data.sessions = data.sessions.filter((s) => new Date(s.expiresAt).getTime() > t);
    if (data.sessions.length !== before) save();
  }

  return {
    data,
    save,
    pruneSessions,

    businessById(id) {
      return data.businesses.find((b) => b.id === id) || null;
    },
    businessByPhone(phone) {
      return data.businesses.find((b) => b.phone === phone) || null;
    },

    createSession(businessId) {
      pruneSessions();
      const token = nid(24);
      const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
      data.sessions.push({ token, businessId, createdAt: nowIso(), expiresAt });
      save();
      return token;
    },

    sessionBusiness(token) {
      if (!token) return null;
      const s = data.sessions.find((x) => x.token === token);
      if (!s) return null;
      if (new Date(s.expiresAt).getTime() <= Date.now()) return null;
      return data.businesses.find((b) => b.id === s.businessId) || null;
    },

    dropSession(token) {
      data.sessions = data.sessions.filter((s) => s.token !== token);
      save();
    },

    nextQuoteNo(businessId) {
      const biz = data.businesses.find((b) => b.id === businessId);
      if (!biz) return "KW-0001";
      biz.nextNo = (biz.nextNo || 1) + 1;
      const n = biz.nextNo - 1;
      return `KW-${String(n).padStart(4, "0")}`;
    },

    quotesFor(businessId) {
      return data.quotes
        .filter((q) => q.businessId === businessId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },

    quoteById(id) {
      return data.quotes.find((q) => q.id === id) || null;
    },

    quoteByPublic(publicId) {
      return data.quotes.find((q) => q.publicId === publicId) || null;
    },
  };
}
