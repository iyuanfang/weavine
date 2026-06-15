-- FTS5 virtual table for contact search
DROP TABLE IF EXISTS contact_fts;

CREATE VIRTUAL TABLE contact_fts USING fts5(
  name,
  company,
  title,
  city,
  email,
  phone,
  wechat,
  notes,
  content='',
  tokenize='unicode61 remove_diacritics 2'
);

-- Triggers to keep FTS in sync with Contact
CREATE TRIGGER IF NOT EXISTS contact_ai AFTER INSERT ON Contact BEGIN
  INSERT INTO contact_fts(rowid, name, company, title, city, email, phone, wechat, notes)
  VALUES (
    new.rowid,
    COALESCE(new.name, ''),
    COALESCE(new.company, ''),
    COALESCE(new.title, ''),
    COALESCE(new.city, ''),
    COALESCE(new.email, ''),
    COALESCE(new.phone, ''),
    COALESCE(new.wechat, ''),
    COALESCE(new.notes, '')
  );
END;

CREATE TRIGGER IF NOT EXISTS contact_ad AFTER DELETE ON Contact BEGIN
  INSERT INTO contact_fts(contact_fts, rowid) VALUES('delete', old.rowid);
END;

CREATE TRIGGER IF NOT EXISTS contact_au AFTER UPDATE ON Contact BEGIN
  INSERT INTO contact_fts(contact_fts, rowid) VALUES('delete', old.rowid);
  INSERT INTO contact_fts(rowid, name, company, title, city, email, phone, wechat, notes)
  VALUES (
    new.rowid,
    COALESCE(new.name, ''),
    COALESCE(new.company, ''),
    COALESCE(new.title, ''),
    COALESCE(new.city, ''),
    COALESCE(new.email, ''),
    COALESCE(new.phone, ''),
    COALESCE(new.wechat, ''),
    COALESCE(new.notes, '')
  );
END;
