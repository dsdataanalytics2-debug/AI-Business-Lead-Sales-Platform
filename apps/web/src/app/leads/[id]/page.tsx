'use client';

import React, { useState, useEffect, useCallback, useReducer, useRef, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Users,
  ArrowLeft,
  Building2,
  MapPin,
  Phone,
  Mail,
  Globe,
  ExternalLink,
  Edit,
  Plus,
  Loader2,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  X,
  RotateCcw
} from 'lucide-react';
import {
  ContactType,
  WhatsAppStatus,
  WebsiteStatus,
  Permissions
} from '@leadmate/shared';
import { useAuth } from '@/lib/auth-context';
import { AppShell } from '@/components/layout/app-shell';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { getSafeExternalUrl } from '@/lib/safe-url';
import { formatDate } from '@/lib/format-date';
import {
  buildLeadPatchPayload,
  type EditLeadFormState
} from '@/lib/leads/lead-patch-payload';
import {
  buildManualContactPayload,
  resolveAddContactOutcome
} from '@/lib/leads/manual-contact-payload';
import {
  leadDetailReducer,
  initialLeadDetailState,
  classifyLeadDetailError
} from '@/lib/leads/lead-detail-state';
import { OnlinePresenceAnalysisCard } from '@/components/leads/online-presence-analysis-card';

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const leadId = resolvedParams.id;

  const { user, isAuthenticated, isLoading: isAuthLoading, hasPermission } = useAuth();
  const router = useRouter();

  const canReadLeads = hasPermission(Permissions.LEADS_READ);
  const canWriteLeads = hasPermission(Permissions.LEADS_WRITE);

  // Pure reducer page state
  const [pageState, dispatch] = useReducer(leadDetailReducer, initialLeadDetailState);

  // Request sequencing and abort controller refs
  const requestIdRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Feedback message state and timer ref
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = (type: 'success' | 'info' | 'error', text: string) => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    setFeedbackMessage({ type, text });
    feedbackTimerRef.current = setTimeout(() => {
      setFeedbackMessage(null);
    }, 4000);
  };

  // Edit Lead Modal State
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditLeadFormState>({
    name: '',
    category: '',
    description: '',
    address: '',
    locality: '',
    city: '',
    website: ''
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<{
    message: string;
    code?: string;
    requestId?: string;
    details?: unknown;
  } | null>(null);

  // Add Contact Modal State
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [contactForm, setContactForm] = useState<{
    type: ContactType;
    rawValue: string;
    isPrimary: boolean;
  }>({
    type: ContactType.PHONE,
    rawValue: '',
    isPrimary: false
  });
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [contactError, setContactError] = useState<{
    message: string;
    code?: string;
    requestId?: string;
    details?: unknown;
  } | null>(null);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthLoading, isAuthenticated, router]);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const fetchLeadDetail = useCallback(
    async (silent = false) => {
      if (!leadId) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      requestIdRef.current += 1;
      const currentRequestId = requestIdRef.current;

      if (!silent) {
        dispatch({ type: 'FETCH_START', leadId, requestId: currentRequestId });
      } else {
        dispatch({ type: 'REFRESH_START' });
      }

      try {
        const data = await apiClient.leads.get(leadId, { signal: abortController.signal });
        if (!silent) {
          dispatch({
            type: 'FETCH_SUCCESS',
            payload: { lead: data, requestId: currentRequestId }
          });
        } else {
          dispatch({
            type: 'REFRESH_SUCCESS',
            payload: { lead: data }
          });
        }
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === 'AbortError' || abortController.signal.aborted) {
          return;
        }
        if (silent) {
          dispatch({
            type: 'REFRESH_ERROR',
            payload: {
              warning: 'Saved, but could not refresh. Retry.'
            }
          });
        } else {
          const classified = classifyLeadDetailError(err);
          dispatch({
            type: 'FETCH_ERROR',
            payload: {
              error: classified,
              requestId: currentRequestId
            }
          });
        }
      }
    },
    [leadId]
  );

  useEffect(() => {
    if (isAuthenticated && canReadLeads && leadId) {
      fetchLeadDetail(false);
    }
  }, [isAuthenticated, canReadLeads, leadId, fetchLeadDetail]);

  // Modal Open Handlers (Reset forms and clear errors)
  const handleOpenEdit = () => {
    if (pageState.status !== 'ready') return;
    const currentLead = pageState.lead;
    setEditForm({
      name: currentLead.name || '',
      category: currentLead.category || '',
      description: currentLead.description || '',
      address: currentLead.address || '',
      locality: currentLead.locality || '',
      city: currentLead.city || '',
      website: currentLead.website || ''
    });
    setEditError(null);
    setIsEditOpen(true);
  };

  const handleCloseEdit = () => {
    if (isSavingEdit) return;
    setIsEditOpen(false);
    setEditError(null);
  };

  const handleOpenAddContact = () => {
    setContactForm({
      type: ContactType.PHONE,
      rawValue: '',
      isPrimary: false
    });
    setContactError(null);
    setIsAddContactOpen(true);
  };

  const handleCloseAddContact = () => {
    if (isSavingContact) return;
    setIsAddContactOpen(false);
    setContactError(null);
  };

  // Keyboard Escape listener for dialogs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isEditOpen && !isSavingEdit) {
          setIsEditOpen(false);
          setEditError(null);
        }
        if (isAddContactOpen && !isSavingContact) {
          setIsAddContactOpen(false);
          setContactError(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditOpen, isSavingEdit, isAddContactOpen, isSavingContact]);

  // Handle Edit Lead Submission
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingEdit || pageState.status !== 'ready' || !canWriteLeads) return;

    const currentLead = pageState.lead;
    const patchPayload = buildLeadPatchPayload(currentLead, editForm);

    if (Object.keys(patchPayload).length === 0) {
      // Nothing changed, close modal
      setIsEditOpen(false);
      return;
    }

    try {
      setIsSavingEdit(true);
      setEditError(null);

      await apiClient.leads.update(currentLead.id, patchPayload);

      setIsEditOpen(false);
      showFeedback('success', 'Lead updated successfully.');

      // Perform silent refetch
      await fetchLeadDetail(true);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.statusCode === 409) {
          setEditError({
            message: 'Another lead already uses this website domain.',
            code: err.code,
            requestId: err.requestId
          });
        } else {
          setEditError({
            message: err.message || 'Failed to update lead attributes.',
            code: err.code,
            requestId: err.requestId,
            details: err.details
          });
        }
      } else {
        setEditError({
          message: 'Network error while saving changes. Please try again.'
        });
      }
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Handle Add Manual Contact Submission
  const handleAddContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingContact || pageState.status !== 'ready' || !canWriteLeads) return;

    const currentLead = pageState.lead;
    const trimmedValue = contactForm.rawValue.trim();
    if (!trimmedValue) {
      setContactError({ message: 'Contact value is required.' });
      return;
    }

    try {
      setIsSavingContact(true);
      setContactError(null);

      // Send ONLY { type, rawValue, isPrimary } - pure builder
      const payload = buildManualContactPayload({
        type: contactForm.type,
        rawValue: trimmedValue,
        isPrimary: contactForm.isPrimary
      });

      const returnedContact = await apiClient.leads.addContact(currentLead.id, payload);

      // Resolve outcome based on returned contact vs existing contacts
      const outcome = resolveAddContactOutcome(currentLead.contacts, returnedContact);

      setIsAddContactOpen(false);
      setContactForm({ type: ContactType.PHONE, rawValue: '', isPrimary: false });

      if (outcome === 'PROMOTED_TO_PRIMARY') {
        showFeedback('info', 'Existing contact set as primary.');
      } else if (outcome === 'ALREADY_EXISTS') {
        showFeedback('info', 'Contact already exists on this lead.');
      } else if (outcome === 'CREATED_INVALID_FORMAT') {
        showFeedback('info', 'Contact saved, but format is invalid for this contact type.');
      } else {
        showFeedback('success', 'Contact added successfully.');
      }

      // Perform silent refetch (never append locally)
      await fetchLeadDetail(true);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setContactError({
          message: err.message || 'Failed to add contact.',
          code: err.code,
          requestId: err.requestId,
          details: err.details
        });
      } else {
        setContactError({
          message: 'Network error while saving contact. Please try again.'
        });
      }
    } finally {
      setIsSavingContact(false);
    }
  };

  if (isAuthLoading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <div className="text-xs text-slate-400 font-mono">Verifying Session...</div>
        </div>
      </div>
    );
  }

  if (!canReadLeads) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto mt-12 p-8 rounded-xl bg-slate-950/70 border border-slate-800 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-400">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold text-slate-200">Access Restricted</h2>
          <p className="text-xs text-slate-400">
            You do not have permission to view lead details.
          </p>
        </div>
      </AppShell>
    );
  }

  // 1. Loading State
  if (pageState.status === 'loading') {
    return (
      <AppShell>
        <div className="max-w-5xl mx-auto py-16 text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mx-auto" />
          <div className="text-sm font-semibold text-slate-200">Loading lead details...</div>
          <p className="text-xs text-slate-500 font-mono">Fetching relations and contact audit trails.</p>
        </div>
      </AppShell>
    );
  }

  // 2. 404 Not Found State
  if (pageState.status === 'notFound') {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto mt-12 p-8 rounded-xl bg-slate-950/70 border border-slate-800 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto text-amber-400">
            <Users className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold text-slate-200">Lead not found.</h2>
          <p className="text-xs text-slate-400">
            The requested lead does not exist or has been removed.
          </p>
          <div className="pt-2">
            <Link
              href="/leads"
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Master Leads</span>
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  // 3. Error State (Non-404)
  if (pageState.status === 'error') {
    if (pageState.statusCode === 401) {
      return (
        <AppShell>
          <div className="max-w-2xl mx-auto mt-12 p-8 rounded-xl bg-red-950/40 border border-red-800/50 text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-400">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-base font-semibold text-red-200">Session Expired</h2>
            <p className="text-xs text-red-300">Your session has expired. Please sign in again.</p>
            <div className="pt-2 flex justify-center gap-3">
              <Link
                href="/login"
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors inline-flex items-center gap-1.5"
              >
                <span>Sign In</span>
              </Link>
            </div>
          </div>
        </AppShell>
      );
    }

    return (
      <AppShell>
        <div className="max-w-2xl mx-auto mt-12 p-8 rounded-xl bg-red-950/40 border border-red-800/50 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-400">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold text-red-200">Error Loading Lead</h2>
          <p className="text-xs text-red-300">{pageState.message}</p>
          {pageState.code && (
            <div className="text-[11px] font-mono text-red-400">
              Error Code: {pageState.code}
            </div>
          )}
          {pageState.requestId && (
            <div className="text-[10px] font-mono text-slate-400">
              Reference: {pageState.requestId}
            </div>
          )}
          {pageState.statusCode === 422 && pageState.details && (
            <div className="p-3 bg-red-950/60 rounded text-left text-[11px] font-mono text-red-300 max-h-40 overflow-y-auto">
              <pre>{JSON.stringify(pageState.details, null, 2) || ''}</pre>
            </div>
          )}
          <div className="pt-3 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => fetchLeadDetail(false)}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Retry</span>
            </button>
            <Link
              href="/leads"
              className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 transition-colors inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Leads</span>
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  // 4. Ready State
  const lead = pageState.lead;
  const safeWebsite = getSafeExternalUrl(lead.website);

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto space-y-6 pb-12">
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <Link
              href="/leads"
              className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Back to Leads"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white tracking-tight">{lead.name}</h1>
                {lead.category && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-slate-300 font-medium">
                    {lead.category}
                  </span>
                )}
                {pageState.isRefreshing && (
                  <span className="flex items-center gap-1 text-[10px] text-indigo-400 font-mono">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Syncing...</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                <span>{lead.city}</span>
                {lead.locality && <span>• {lead.locality}</span>}
                {lead.country && <span>• {lead.country}</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canWriteLeads && (
              <>
                <button
                  type="button"
                  id="lead-edit-btn"
                  onClick={handleOpenEdit}
                  className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 rounded-lg border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Edit className="w-3.5 h-3.5 text-slate-400" />
                  <span>Edit Lead</span>
                </button>

                <button
                  type="button"
                  id="lead-add-contact-btn"
                  onClick={handleOpenAddContact}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-sm shadow-indigo-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Contact</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Feedback Alert Message */}
        {feedbackMessage && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-3 shadow-sm ${
              feedbackMessage.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300'
                : feedbackMessage.type === 'info'
                ? 'bg-indigo-950/40 border-indigo-800/50 text-indigo-300'
                : 'bg-red-950/40 border-red-800/50 text-red-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{feedbackMessage.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="text-slate-400 hover:text-white"
              aria-label="Dismiss feedback"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Non-destructive Refresh Warning Banner */}
        {pageState.refreshWarning && (
          <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/50 text-amber-300 text-xs flex items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <span>{pageState.refreshWarning}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => fetchLeadDetail(true)}
              className="px-2.5 py-1 text-xs font-medium rounded bg-amber-900/60 hover:bg-amber-900 text-amber-200 border border-amber-700 transition-colors cursor-pointer"
            >
              Retry Sync
            </button>
          </div>
        )}

        {/* Main Grid: Business Overview & Contacts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Business Details & Online Presence */}
          <div className="lg:col-span-1 space-y-6">
            {/* Identity Card */}
            <div className="p-5 rounded-xl bg-slate-950/70 border border-slate-800 shadow-md space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-indigo-400" />
                <span>Business Identity</span>
              </h2>

              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-slate-500 block text-[11px]">Primary Phone</span>
                  <div className="text-slate-200 font-mono mt-0.5 flex items-center gap-1.5">
                    {lead.primaryPhone ? (
                      <>
                        <Phone className="w-3 h-3 text-indigo-400" />
                        <span>{lead.primaryPhone}</span>
                      </>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 block text-[11px]">Primary Email</span>
                  <div className="text-slate-200 mt-0.5 flex items-center gap-1.5">
                    {lead.primaryEmail ? (
                      <>
                        <Mail className="w-3 h-3 text-sky-400" />
                        <span className="truncate">{lead.primaryEmail}</span>
                      </>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 block text-[11px]">Website</span>
                  <div className="text-slate-200 mt-0.5">
                    {safeWebsite ? (
                      <a
                        href={safeWebsite.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1 truncate"
                      >
                        <Globe className="w-3 h-3 shrink-0" />
                        <span className="truncate">{safeWebsite.label}</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </div>
                </div>

                {lead.address && (
                  <div>
                    <span className="text-slate-500 block text-[11px]">Address</span>
                    <div className="text-slate-300 mt-0.5 flex items-start gap-1.5">
                      <MapPin className="w-3 h-3 text-slate-400 mt-0.5 shrink-0" />
                      <span>{lead.address}</span>
                    </div>
                  </div>
                )}

                {lead.description && (
                  <div className="pt-2 border-t border-slate-800/80">
                    <span className="text-slate-500 block text-[11px] mb-1">Description</span>
                    <p className="text-slate-300 text-xs leading-relaxed">{lead.description}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Online Presence & Website Status */}
            <div className="p-5 rounded-xl bg-slate-950/70 border border-slate-800 shadow-md space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-indigo-400" />
                <span>Online Presence</span>
              </h2>

              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Presence Type:</span>
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-200 font-medium">
                    {lead.onlinePresenceType}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Website Status:</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                      lead.websiteStatus === WebsiteStatus.REACHABLE
                        ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50'
                        : lead.websiteStatus === WebsiteStatus.UNREACHABLE
                        ? 'bg-red-950/40 text-red-300 border-red-800/50'
                        : 'bg-slate-900 text-slate-400 border-slate-800'
                    }`}
                  >
                    {lead.websiteStatus}
                  </span>
                </div>
              </div>
            </div>

            {/* Metadata / Provenance */}
            <div className="p-5 rounded-xl bg-slate-950/70 border border-slate-800 shadow-md space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-indigo-400" />
                <span>System Metadata</span>
              </h2>

              <div className="space-y-2 text-[11px] text-slate-400">
                <div className="flex items-center justify-between">
                  <span>Primary Source:</span>
                  <span className="font-mono text-slate-300">{lead.primarySource}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Created:</span>
                  <span className="text-slate-300">{formatDate(lead.createdAt)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Last Updated:</span>
                  <span className="text-slate-300">{formatDate(lead.updatedAt)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Online Presence Analysis, Verified Contacts & Evidence */}
          <div className="lg:col-span-2 space-y-6">
            {/* Online Presence Analysis Card */}
            <OnlinePresenceAnalysisCard
              leadId={lead.id}
              canWrite={canWriteLeads}
              onAnalysisUpdated={() => fetchLeadDetail(true)}
            />

            {/* Direct Contacts Section */}
            <div className="p-5 rounded-xl bg-slate-950/70 border border-slate-800 shadow-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Contacts ({lead.contacts.length})</span>
                </h2>

                {canWriteLeads && (
                  <button
                    type="button"
                    onClick={handleOpenAddContact}
                    className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Manual</span>
                  </button>
                )}
              </div>

              {lead.contacts.length === 0 ? (
                <div className="p-6 rounded-lg bg-slate-900/40 border border-slate-800/80 text-center text-xs text-slate-500">
                  No direct contact channels discovered yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {lead.contacts.map((contact) => (
                    <div
                      key={contact.id}
                      className={`p-3.5 rounded-xl border text-xs transition-all ${
                        contact.isSuppressed
                          ? 'bg-rose-950/20 border-rose-900/40'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-mono uppercase font-semibold">
                            {contact.type}
                          </span>

                          <span className="font-mono text-slate-100 text-xs font-medium">
                            {contact.rawValue}
                          </span>

                          {contact.isPrimary && (
                            <span className="px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-700/50 text-[10px] font-medium">
                              PRIMARY
                            </span>
                          )}

                          {contact.isSuppressed && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-700/50 text-[10px] font-medium flex items-center gap-1">
                              <span>SUPPRESSED ({contact.suppressionReason || 'OPT_OUT'})</span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {contact.type === ContactType.WHATSAPP && (
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded border font-medium ${
                                contact.whatsappStatus === WhatsAppStatus.CONFIRMED ||
                                contact.whatsappStatus === WhatsAppStatus.PUBLICLY_LISTED
                                  ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800/50'
                                  : 'bg-slate-800 text-slate-400 border-slate-700'
                              }`}
                            >
                              WhatsApp: {contact.whatsappStatus}
                            </span>
                          )}

                          <span className="text-[10px] text-slate-500 font-mono">
                            Status: {contact.status}
                          </span>
                        </div>
                      </div>

                      {/* Evidence Trail */}
                      <div className="mt-2.5 pt-2 border-t border-slate-800/60 text-[11px] text-slate-400">
                        {contact.evidence.length === 0 ? (
                          <div className="text-slate-500 italic text-[11px]">
                            Manual entry - no external evidence
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <span className="text-[10px] uppercase font-semibold text-slate-500 block">
                              Evidence ({contact.evidence.length})
                            </span>
                            {contact.evidence.map((ev) => (
                              <div
                                key={ev.id}
                                className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-950/40 px-2 py-1 rounded"
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="text-slate-300 font-medium">{ev.sourceName}</span>
                                  <span>({ev.evidenceType})</span>
                                  {ev.snippet && (
                                    <span className="text-slate-500 italic truncate max-w-xs">
                                      &quot;{ev.snippet}&quot;
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-slate-500">
                                  {formatDate(ev.discoveredAt)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sources & Extraction History */}
            <div className="p-5 rounded-xl bg-slate-950/70 border border-slate-800 shadow-md space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-indigo-400" />
                <span>Source Provenance ({lead.sources.length})</span>
              </h2>

              {lead.sources.length === 0 ? (
                <div className="p-6 rounded-lg bg-slate-900/40 border border-slate-800/80 text-center text-xs text-slate-500">
                  No directory source records attached.
                </div>
              ) : (
                <div className="space-y-2">
                  {lead.sources.map((src) => {
                    const safeSrcUrl = getSafeExternalUrl(src.sourceUrl);
                    return (
                      <div
                        key={src.id}
                        className="p-3 rounded-lg bg-slate-900/40 border border-slate-800/80 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-semibold text-slate-200">{src.sourceName}</div>
                          {safeSrcUrl && (
                            <a
                              href={safeSrcUrl.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] text-indigo-400 hover:underline flex items-center gap-1 mt-0.5"
                            >
                              <span className="truncate max-w-sm">{safeSrcUrl.label}</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {formatDate(src.fetchedAt)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Edit Lead Modal */}
        {isEditOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-lead-modal-title"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
          >
            <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 id="edit-lead-modal-title" className="text-base font-bold text-white">
                  Edit Lead Attributes
                </h3>
                <button
                  type="button"
                  onClick={handleCloseEdit}
                  disabled={isSavingEdit}
                  className="text-slate-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                  aria-label="Close dialog"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {editError && (
                <div className="p-3 rounded-lg bg-red-950/50 border border-red-800/60 text-xs text-red-300 space-y-1">
                  <div>{editError.message}</div>
                  {editError.code && (
                    <div className="font-mono text-[10px] text-red-400">Code: {editError.code}</div>
                  )}
                  {editError.requestId && (
                    <div className="font-mono text-[10px] text-red-400">Ref: {editError.requestId}</div>
                  )}
                  {Boolean(editError.details && typeof editError.details === 'object') && (
                    <pre className="mt-1 p-2 bg-red-950 rounded text-[10px] overflow-x-auto text-red-300">
                      {JSON.stringify(editError.details, null, 2) || ''}
                    </pre>
                  )}
                </div>
              )}

              <form onSubmit={handleEditSubmit} className="space-y-3 text-xs">
                <div>
                  <label htmlFor="edit-name" className="block text-slate-300 font-medium mb-1">
                    Business Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="edit-name"
                    type="text"
                    required
                    value={editForm.name}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="edit-category" className="block text-slate-300 font-medium mb-1">
                      Category <span className="text-red-400">*</span>
                    </label>
                    <input
                      id="edit-category"
                      type="text"
                      required
                      value={editForm.category}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, category: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="edit-city" className="block text-slate-300 font-medium mb-1">
                      City <span className="text-red-400">*</span>
                    </label>
                    <input
                      id="edit-city"
                      type="text"
                      required
                      value={editForm.city}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, city: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="edit-locality" className="block text-slate-300 font-medium mb-1">
                      Locality
                    </label>
                    <input
                      id="edit-locality"
                      type="text"
                      value={editForm.locality}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, locality: e.target.value }))}
                      placeholder="e.g. Gulshan, Banani"
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="edit-website" className="block text-slate-300 font-medium mb-1">
                      Website URL
                    </label>
                    <input
                      id="edit-website"
                      type="text"
                      value={editForm.website}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, website: e.target.value }))}
                      placeholder="https://example.com"
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="edit-address" className="block text-slate-300 font-medium mb-1">
                    Full Address
                  </label>
                  <input
                    id="edit-address"
                    type="text"
                    value={editForm.address}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, address: e.target.value }))}
                    placeholder="Street address, building number..."
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="edit-description" className="block text-slate-300 font-medium mb-1">
                    Description
                  </label>
                  <textarea
                    id="edit-description"
                    rows={3}
                    value={editForm.description}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Short description of the business..."
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={handleCloseEdit}
                    disabled={isSavingEdit}
                    className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    id="edit-submit-btn"
                    disabled={isSavingEdit}
                    className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg shadow-sm shadow-indigo-500/20 transition-all flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isSavingEdit ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <span>Save Changes</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add Contact Modal */}
        {isAddContactOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-contact-modal-title"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
          >
            <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 id="add-contact-modal-title" className="text-base font-bold text-white">
                  Add Direct Contact
                </h3>
                <button
                  type="button"
                  onClick={handleCloseAddContact}
                  disabled={isSavingContact}
                  className="text-slate-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                  aria-label="Close dialog"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {contactError && (
                <div className="p-3 rounded-lg bg-red-950/50 border border-red-800/60 text-xs text-red-300 space-y-1">
                  <div>{contactError.message}</div>
                  {contactError.code && (
                    <div className="font-mono text-[10px] text-red-400">Code: {contactError.code}</div>
                  )}
                  {contactError.requestId && (
                    <div className="font-mono text-[10px] text-red-400">Ref: {contactError.requestId}</div>
                  )}
                  {Boolean(contactError.details && typeof contactError.details === 'object') && (
                    <pre className="mt-1 p-2 bg-red-950 rounded text-[10px] overflow-x-auto text-red-300">
                      {JSON.stringify(contactError.details, null, 2) || ''}
                    </pre>
                  )}
                </div>
              )}

              <form onSubmit={handleAddContactSubmit} className="space-y-3 text-xs">
                <div>
                  <label htmlFor="contact-type" className="block text-slate-300 font-medium mb-1">
                    Contact Channel Type <span className="text-red-400">*</span>
                  </label>
                  <select
                    id="contact-type"
                    value={contactForm.type}
                    onChange={(e) => setContactForm((prev) => ({ ...prev, type: e.target.value as ContactType }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  >
                    <option value={ContactType.PHONE}>Phone (Local/National/Mobile)</option>
                    <option value={ContactType.EMAIL}>Email Address</option>
                    <option value={ContactType.WHATSAPP}>WhatsApp Channel</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="contact-value" className="block text-slate-300 font-medium mb-1">
                    Contact Value <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="contact-value"
                    type="text"
                    required
                    value={contactForm.rawValue}
                    onChange={(e) => setContactForm((prev) => ({ ...prev, rawValue: e.target.value }))}
                    placeholder={
                      contactForm.type === ContactType.EMAIL
                        ? 'contact@business.com'
                        : '01711000000 / +8801711000000'
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Standardized on the server (Bengali numerals and punctuation will be normalized).
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    id="contact-is-primary"
                    type="checkbox"
                    checked={contactForm.isPrimary}
                    onChange={(e) => setContactForm((prev) => ({ ...prev, isPrimary: e.target.checked }))}
                    className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                  />
                  <label htmlFor="contact-is-primary" className="text-slate-300 font-medium cursor-pointer">
                    Set as Primary Contact for this business
                  </label>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={handleCloseAddContact}
                    disabled={isSavingContact}
                    className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    id="contact-submit-btn"
                    disabled={isSavingContact}
                    className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg shadow-sm shadow-indigo-500/20 transition-all flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isSavingContact ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Adding...</span>
                      </>
                    ) : (
                      <span>Add Contact</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
