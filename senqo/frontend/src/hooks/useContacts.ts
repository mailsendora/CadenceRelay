import { useState, useCallback, useEffect } from "react";
import { api } from "@/lib/api";
import { CRM_UI_PAGE_SIZE } from "@/lib/crm-limits";
import type { ContactRecord } from "@/types/ui";

export type NewContact = { firstName: string; lastName: string; phone: string; note?: string };

function parseCsv(text: string): Array<Record<string, string>> {
  const rows = text.trim().split(/\r?\n/).map((line) => line.split(",").map((v) => v.replace(/^"|"$/g, "").replace(/""/g, '"')));
  const headers = rows.shift() ?? [];
  return rows.filter((r) => r.length >= headers.length).map((r) => Object.fromEntries(headers.map((h, i) => [h.trim(), r[i]?.trim() ?? ""])));
}

export type ContactsQuery = {
  page: number;
  search: string;
  hasMetadataOnly: boolean;
  testOnly: boolean;
};

type ContactsPageResponse = {
  contacts: ContactRecord[];
  total: number;
  page: number;
  pageSize: number;
};

function buildContactsQueryString(query: ContactsQuery): string {
  const params = new URLSearchParams();
  params.set("page", String(query.page));
  params.set("pageSize", String(CRM_UI_PAGE_SIZE));
  if (query.search.trim()) params.set("search", query.search.trim());
  if (query.hasMetadataOnly) params.set("hasMetadata", "on");
  if (query.testOnly) params.set("testOnly", "on");
  return params.toString();
}

export function useContacts(query: ContactsQuery) {
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [updatingIsTestId, setUpdatingIsTestId] = useState<string | null>(null);
  const [deletingContactId, setDeletingContactId] = useState<string | null>(null);

  const fetchPage = useCallback(async (nextQuery: ContactsQuery) => {
    setLoading(true);
    try {
      const res = await api.get<ContactsPageResponse>(
        `/api/user/contacts?${buildContactsQueryString(nextQuery)}`,
      );
      setContacts(res.contacts);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPage(query);
  }, [fetchPage, query.page, query.search, query.hasMetadataOnly, query.testOnly]);

  const addContact = useCallback(async (contact: NewContact) => {
    await api.post("/api/user/contacts", {
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone,
      metadata: contact.note ?? "",
    });
  }, []);

  const importCsv = useCallback(async (file: File) => {
    const rows = parseCsv(await file.text());
    if (!rows.length) throw new Error("CSV has no rows");
    await api.post("/api/user/contacts/import", rows);
    await fetchPage(query);
  }, [fetchPage, query.page, query.search, query.hasMetadataOnly, query.testOnly]);

  const exportCsv = useCallback(async () => {
    const blob = await api.getCsv("/api/user/contacts/export");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "senqo-contacts.csv"; a.click(); URL.revokeObjectURL(url);
  }, []);

  const setIsTest = useCallback(async (contactId: string, isTest: boolean) => {
    setUpdatingIsTestId(contactId);
    try {
      await api.patch(`/api/user/contacts/${contactId}/test`, { isTest });
      setContacts((current) =>
        current.map((contact) =>
          contact.id === contactId ? { ...contact, is_test: isTest } : contact,
        ),
      );
    } finally {
      setUpdatingIsTestId(null);
    }
  }, []);

  const deleteContact = useCallback(
    async (contactId: string) => {
      setDeletingContactId(contactId);
      try {
        await api.delete(`/api/user/contacts/${contactId}`);
        await fetchPage(query);
      } finally {
        setDeletingContactId(null);
      }
    },
    [fetchPage, query.page, query.search, query.hasMetadataOnly, query.testOnly],
  );

  return {
    contacts,
    total,
    loading,
    pageSize: CRM_UI_PAGE_SIZE,
    addContact,
    importCsv,
    exportCsv,
    setIsTest,
    deleteContact,
    refetch: () => fetchPage(query),
    updatingIsTestId,
    deletingContactId,
  };
}
