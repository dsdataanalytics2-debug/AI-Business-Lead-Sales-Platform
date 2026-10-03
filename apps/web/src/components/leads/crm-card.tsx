'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Layers,
  UserCheck,
  UserX,
  Users,
  MessageSquare,
  History,
  Send,
  Loader2,
  AlertCircle,
  RotateCcw,
  Clock,
  ArrowRight,
  CheckCircle2
} from 'lucide-react';
import {
  CrmStage,
  CRM_STAGE_LABELS,
  ORDERED_CRM_STAGES,
  CrmActivityType,
  type AssigneeSummary,
  type CrmNote,
  type CrmActivity
} from '@leadmate/shared';
import { apiClient } from '@/lib/api-client';
import { formatDate } from '@/lib/format-date';
import {
  formatActivityLabel,
  formatStageTransition,
  formatActorName,
  validateNoteContent,
  classifyCrmStageError,
  classifyAssignmentError,
  classifyNoteError,
  classifyCrmSecondaryLoadError
} from '@/lib/leads/crm-display';

interface CrmCardProps {
  leadId: string;
  initialStage?: CrmStage;
  initialAssignedUserId?: string | null;
  initialAssignedUser?: AssigneeSummary | null;
  initialAssignedAt?: string | Date | null;
  canWrite: boolean;
  canAssign: boolean;
  onStageChanged?: (newStage: CrmStage) => void;
  onAssignmentChanged?: (
    assignedUserId: string | null,
    assignedUser: AssigneeSummary | null,
    assignedAt: string | Date | null
  ) => void;
}

export function CrmCard({
  leadId,
  initialStage = CrmStage.NEW,
  initialAssignedUserId = null,
  initialAssignedUser = null,
  initialAssignedAt = null,
  canWrite,
  canAssign,
  onStageChanged,
  onAssignmentChanged
}: CrmCardProps) {
  // Stage state
  const [currentStage, setCurrentStage] = useState<CrmStage>(initialStage);
  const [isUpdatingStage, setIsUpdatingStage] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);

  // Assignment state
  const [assignedUserId, setAssignedUserId] = useState<string | null>(initialAssignedUserId);
  const [assignedUser, setAssignedUser] = useState<AssigneeSummary | null>(initialAssignedUser);
  const [assignedAt, setAssignedAt] = useState<string | Date | null>(initialAssignedAt);
  const [assignees, setAssignees] = useState<AssigneeSummary[]>([]);
  const [isUpdatingAssignment, setIsUpdatingAssignment] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  // Notes state
  const [notes, setNotes] = useState<CrmNote[]>([]);
  const [noteContent, setNoteContent] = useState('');
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  // Activities state
  const [activities, setActivities] = useState<CrmActivity[]>([]);

  // Secondary CRM data loading state
  const [isLoadingCrm, setIsLoadingCrm] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Sync state with props when lead changes
  useEffect(() => {
    setCurrentStage(initialStage || CrmStage.NEW);
    setAssignedUserId(initialAssignedUserId ?? null);
    setAssignedUser(initialAssignedUser ?? null);
    setAssignedAt(initialAssignedAt ?? null);
    setStageError(null);
    setAssignmentError(null);
    setNoteError(null);
  }, [leadId, initialStage, initialAssignedUserId, initialAssignedUser, initialAssignedAt]);

  // Load secondary CRM data (notes, activities, assignees)
  const loadCrmData = useCallback(async () => {
    if (!leadId) return;
    setIsLoadingCrm(true);
    setLoadError(null);

    try {
      const promises: [
        Promise<CrmNote[]>,
        Promise<CrmActivity[]>,
        Promise<AssigneeSummary[]> | null
      ] = [
        apiClient.leads.getNotes(leadId),
        apiClient.leads.getActivities(leadId),
        canAssign ? apiClient.leads.getAssignees() : null
      ];

      const [notesRes, activitiesRes, assigneesRes] = await Promise.all([
        promises[0],
        promises[1],
        promises[2] ? promises[2] : Promise.resolve([])
      ]);

      setNotes(notesRes || []);
      setActivities(activitiesRes || []);
      if (canAssign && assigneesRes) {
        setAssignees(assigneesRes);
      }
    } catch (err) {
      setLoadError(classifyCrmSecondaryLoadError(err));
    } finally {
      setIsLoadingCrm(false);
    }
  }, [leadId, canAssign]);

  useEffect(() => {
    loadCrmData();
  }, [loadCrmData]);

  // Refresh activity timeline silently after mutations
  const refreshActivities = async () => {
    if (!leadId) return;
    try {
      const acts = await apiClient.leads.getActivities(leadId);
      setActivities(acts || []);
    } catch {
      // Activity refresh failure is non-blocking
    }
  };

  // Handle Stage Update
  const handleStageChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStage = e.target.value as CrmStage;
    if (!canWrite || isUpdatingStage || newStage === currentStage) return;

    setIsUpdatingStage(true);
    setStageError(null);

    try {
      const result = await apiClient.leads.updateCrmStage(leadId, newStage);
      setCurrentStage(result.crmStage);
      if (onStageChanged) {
        onStageChanged(result.crmStage);
      }
      await refreshActivities();
    } catch (err) {
      setStageError(classifyCrmStageError(err));
    } finally {
      setIsUpdatingStage(false);
    }
  };

  // Handle Assignment Update
  const handleAssignmentChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedVal = e.target.value;
    const targetUserId = selectedVal === '' ? null : selectedVal;
    if (!canAssign || isUpdatingAssignment || targetUserId === assignedUserId) return;

    setIsUpdatingAssignment(true);
    setAssignmentError(null);

    try {
      const result = await apiClient.leads.updateAssignment(leadId, targetUserId);
      setAssignedUserId(result.assignedUserId);
      setAssignedUser(result.assignedUser);
      setAssignedAt(result.assignedAt);
      if (onAssignmentChanged) {
        onAssignmentChanged(result.assignedUserId, result.assignedUser, result.assignedAt);
      }
      await refreshActivities();
    } catch (err) {
      setAssignmentError(classifyAssignmentError(err));
    } finally {
      setIsUpdatingAssignment(false);
    }
  };

  // Handle Note Submission
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite || isSubmittingNote) return;

    const validation = validateNoteContent(noteContent);
    if (!validation.isValid) {
      setNoteError(validation.error || 'Please enter a valid note.');
      return;
    }

    setIsSubmittingNote(true);
    setNoteError(null);

    try {
      const newNote = await apiClient.leads.addNote(leadId, { content: validation.trimmed });
      setNotes((prev) => [newNote, ...prev]);
      setNoteContent('');
      await refreshActivities();
    } catch (err) {
      setNoteError(classifyNoteError(err));
    } finally {
      setIsSubmittingNote(false);
    }
  };

  const isNoteAddDisabled =
    !canWrite ||
    isSubmittingNote ||
    noteContent.trim().length === 0 ||
    noteContent.trim().length > 5000;

  // Stage badge color helper
  const getStageBadgeStyle = (stage: CrmStage) => {
    switch (stage) {
      case CrmStage.WON:
        return 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60';
      case CrmStage.LOST:
        return 'bg-rose-950/70 text-rose-300 border-rose-700/60';
      case CrmStage.QUALIFIED:
      case CrmStage.PROPOSAL_SENT:
      case CrmStage.NEGOTIATION:
        return 'bg-indigo-950/70 text-indigo-300 border-indigo-700/60';
      case CrmStage.CONTACTED:
        return 'bg-sky-950/70 text-sky-300 border-sky-700/60';
      case CrmStage.NEW:
      default:
        return 'bg-slate-900 text-slate-300 border-slate-700';
    }
  };

  return (
    <div
      id="crm-card"
      className="p-5 sm:p-6 rounded-xl bg-slate-950/70 border border-slate-800 shadow-md space-y-6"
    >
      {/* Card Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
            CRM & Sales Pipeline
          </h2>
        </div>
        {isLoadingCrm && (
          <span className="flex items-center gap-1.5 text-xs text-indigo-400 font-mono">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Loading CRM data...</span>
          </span>
        )}
      </div>

      {/* Secondary Load Error Banner */}
      {loadError && (
        <div
          role="alert"
          className="p-3.5 rounded-lg bg-amber-950/40 border border-amber-800/50 text-amber-300 text-xs flex items-center justify-between gap-3 shadow-sm"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={loadCrmData}
            className="px-2.5 py-1 text-xs font-medium rounded bg-amber-900/60 hover:bg-amber-900 text-amber-200 border border-amber-700 transition-colors flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Top Grid: Stage & Assignment Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 1. Stage Box */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Pipeline Stage
            </span>
            <span
              id="crm-stage-badge"
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getStageBadgeStyle(
                currentStage
              )}`}
            >
              {CRM_STAGE_LABELS[currentStage] || currentStage}
            </span>
          </div>

          {canWrite ? (
            <div className="space-y-1.5">
              <label htmlFor="crm-stage-select" className="text-[11px] text-slate-400 block">
                Update Stage
              </label>
              <div className="relative">
                <select
                  id="crm-stage-select"
                  value={currentStage}
                  onChange={handleStageChange}
                  disabled={isUpdatingStage}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {ORDERED_CRM_STAGES.map((stg) => (
                    <option key={stg} value={stg}>
                      {CRM_STAGE_LABELS[stg]}
                    </option>
                  ))}
                </select>
                {isUpdatingStage && (
                  <div className="absolute right-3 top-2.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 italic">
              Read-only stage (LEADS_WRITE permission required to change).
            </p>
          )}

          {stageError && (
            <div
              role="alert"
              className="p-2 rounded bg-red-950/40 border border-red-800/50 text-red-300 text-[11px] flex items-center gap-1.5"
            >
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-400" />
              <span>{stageError}</span>
            </div>
          )}
        </div>

        {/* 2. Assignment Box */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Assigned Representative
            </span>
            <div className="flex items-center gap-1.5">
              {assignedUser ? (
                <span
                  id="crm-assigned-user-badge"
                  className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-950/80 text-indigo-300 border border-indigo-700/50 flex items-center gap-1"
                >
                  <UserCheck className="w-3 h-3 text-indigo-400" />
                  <span>{assignedUser.name}</span>
                </span>
              ) : (
                <span
                  id="crm-unassigned-badge"
                  className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-900 text-slate-400 border border-slate-800 flex items-center gap-1"
                >
                  <UserX className="w-3 h-3 text-slate-500" />
                  <span>Unassigned</span>
                </span>
              )}
            </div>
          </div>

          {assignedUser && (
            <div className="text-[11px] text-slate-400 space-y-0.5">
              <div className="text-slate-300 truncate">{assignedUser.email}</div>
              {assignedAt && (
                <div className="text-slate-500 text-[10px]">
                  Assigned on: {formatDate(assignedAt)}
                </div>
              )}
            </div>
          )}

          {canAssign ? (
            <div className="space-y-1.5">
              <label htmlFor="crm-assignee-select" className="text-[11px] text-slate-400 block">
                Assign / Reassign Lead
              </label>
              <div className="relative">
                <select
                  id="crm-assignee-select"
                  value={assignedUserId || ''}
                  onChange={handleAssignmentChange}
                  disabled={isUpdatingAssignment}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <option value="">Unassigned</option>
                  {assignees.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} ({user.email})
                    </option>
                  ))}
                </select>
                {isUpdatingAssignment && (
                  <div className="absolute right-3 top-2.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 italic">
              Read-only assignment (LEADS_ASSIGN permission required).
            </p>
          )}

          {assignmentError && (
            <div
              role="alert"
              className="p-2 rounded bg-red-950/40 border border-red-800/50 text-red-300 text-[11px] flex items-center gap-1.5"
            >
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-400" />
              <span>{assignmentError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Grid: Notes & Activity Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
        {/* 1. Notes Feed & Composer */}
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800/60">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
              <span>CRM Notes ({notes.length})</span>
            </h3>
          </div>

          {/* Note Composer (LEADS_WRITE only) */}
          {canWrite ? (
            <form onSubmit={handleAddNote} className="space-y-2">
              <div className="space-y-1">
                <label htmlFor="crm-note-textarea" className="sr-only">
                  Add a CRM note
                </label>
                <textarea
                  id="crm-note-textarea"
                  rows={3}
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Record an interaction, call summary, or lead update..."
                  disabled={isSubmittingNote}
                  maxLength={5000}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-900/90 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none transition-colors disabled:opacity-50"
                />
              </div>

              <div className="flex items-center justify-between">
                <span
                  className={`text-[10px] font-mono ${
                    noteContent.length > 4800 ? 'text-amber-400' : 'text-slate-500'
                  }`}
                >
                  {noteContent.length} / 5000
                </span>

                <button
                  type="submit"
                  id="crm-add-note-btn"
                  disabled={isNoteAddDisabled}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm shadow-indigo-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  {isSubmittingNote ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>Add Note</span>
                </button>
              </div>

              {noteError && (
                <div
                  role="alert"
                  className="p-2 rounded bg-red-950/40 border border-red-800/50 text-red-300 text-[11px] flex items-center gap-1.5"
                >
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-400" />
                  <span>{noteError}</span>
                </div>
              )}
            </form>
          ) : (
            <p className="text-[11px] text-slate-500 italic p-2 bg-slate-900/30 rounded-lg">
              Note composition requires LEADS_WRITE permission.
            </p>
          )}

          {/* Notes Feed */}
          <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
            {notes.length === 0 ? (
              <div
                id="crm-notes-empty"
                className="p-6 rounded-xl bg-slate-900/40 border border-slate-800/60 text-center text-xs text-slate-500"
              >
                No CRM notes yet.
              </div>
            ) : (
              notes.map((note) => (
                <div
                  key={note.id}
                  className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1.5 text-xs"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-200">
                      {formatActorName(note.author)}
                    </span>
                    <span className="text-slate-500 text-[10px] flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-600" />
                      <span>{formatDate(note.createdAt)}</span>
                    </span>
                  </div>
                  <p className="text-slate-300 leading-relaxed whitespace-pre-wrap break-words text-xs">
                    {note.content}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 2. Activity Timeline */}
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800/60">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-indigo-400" />
              <span>Activity Timeline ({activities.length})</span>
            </h3>
          </div>

          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {activities.length === 0 ? (
              <div
                id="crm-activities-empty"
                className="p-6 rounded-xl bg-slate-900/40 border border-slate-800/60 text-center text-xs text-slate-500"
              >
                No activity recorded yet.
              </div>
            ) : (
              activities.map((activity) => {
                const stageTransition =
                  activity.type === CrmActivityType.STAGE_CHANGED
                    ? formatStageTransition(activity.metadata)
                    : null;

                return (
                  <div
                    key={activity.id}
                    className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/70 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-indigo-400" />
                        <span className="font-semibold text-slate-200">
                          {formatActivityLabel(activity.type)}
                        </span>
                      </div>
                      <span className="text-slate-500 text-[10px]">
                        {formatDate(activity.createdAt)}
                      </span>
                    </div>

                    {stageTransition && (
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-indigo-300 font-medium pl-3.5">
                        <span>{stageTransition}</span>
                      </div>
                    )}

                    <div className="text-[10px] text-slate-400 pl-3.5">
                      by <span className="text-slate-300">{formatActorName(activity.actor)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
