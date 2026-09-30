import { create } from 'zustand'
import { authorNameForRole, baseComments, baseParagraphs } from '../data/seed'
import {
  fetchRemoteSnapshot, pushQueuedChange, resetRemote,
  setRemoteOnline, setWeakNetwork, simulateRemoteEdit, simulateRemoteLock, simulateRemoteMerge,
  type RemoteSnapshot,
} from '../services/mockApi'
import type {
  Comment, Paragraph, QueuedChange, QueueKind, RemoteCommentRef, RemoteParagraphRef,
  Reply, Role, ShelvedVersion, SyncSummary, Version,
} from '../types'

type RemoteSnapshotLike = RemoteSnapshot

const DRAFT_KEY = 'sologsb-1002-draft-v1'
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const baseVersions: Version[] = [
  { id: 'v-01', label: '投稿初稿 v1', createdAt: Date.now() - 1209600000, paragraphs: JSON.parse(JSON.stringify(baseParagraphs)) as Paragraph[] },
  { id: 'v-02', label: '审阅基线 v2', createdAt: Date.now() - 172800000, paragraphs: JSON.parse(JSON.stringify(baseParagraphs.map((p) => p.id === 'p-04' ? { ...p, text: `${p.text} 编码规则在预注册方案中说明。` } : p))) as Paragraph[] },
]

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const buildInitialRefs = () => ({
  paragraphs: Object.fromEntries(baseParagraphs.map((paragraph) => [
    paragraph.id,
    { text: paragraph.text, status: paragraph.status, revision: 1, contentRevision: 1, editor: '系统' } satisfies RemoteParagraphRef,
  ])),
  comments: Object.fromEntries(baseComments.map((comment) => [
    comment.id,
    { status: comment.status, mergedInto: comment.mergedInto } satisfies RemoteCommentRef,
  ])) as Record<string, RemoteCommentRef>,
})

const seed = typeof localStorage !== 'undefined' ? localStorage.getItem(DRAFT_KEY) : null
const parsed = seed ? JSON.parse(seed) as {
  paragraphs?: Paragraph[]
  comments?: Comment[]
  versions?: Version[]
  queue?: QueuedChange[]
  shelf?: ShelvedVersion[]
  serverRefs?: { paragraphs: Record<string, RemoteParagraphRef>; comments: Record<string, RemoteCommentRef> }
  lastSyncAt?: number
} : null

const initialParagraphs = parsed?.paragraphs?.length ? parsed.paragraphs : clone(baseParagraphs)
const initialComments = parsed?.comments ?? clone(baseComments)
const initialVersions = parsed?.versions ?? clone(baseVersions)
// 上次同步中途崩溃：sending 的条目一律退回 queued，重新只送没送成功的
const initialQueue = (parsed?.queue ?? []).map((item) => item.status === 'sending' ? { ...item, status: 'queued' as const } : item)
const initialShelf = parsed?.shelf ?? []
const initialRefs = parsed?.serverRefs ?? buildInitialRefs()

interface PersistedState {
  paragraphs: Paragraph[]
  comments: Comment[]
  versions: Version[]
  queue: QueuedChange[]
  shelf: ShelvedVersion[]
  serverRefs: { paragraphs: Record<string, RemoteParagraphRef>; comments: Record<string, RemoteCommentRef> }
  lastSyncAt: number | null
}

const persistDraft = (state: PersistedState) => {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({
    paragraphs: state.paragraphs,
    comments: state.comments,
    versions: state.versions,
    queue: state.queue,
    shelf: state.shelf,
    serverRefs: state.serverRefs,
    lastSyncAt: state.lastSyncAt,
  }))
}

const ACTIVE_STATUSES = new Set(['queued', 'sending', 'failed', 'conflict'])
const pushRank: Record<QueueKind, number> = {
  'comment-add': 0,
  'comment-reply': 1,
  'comment-merge': 2,
  'paragraph-edit': 3,
  'paragraph-lock': 4,
}

interface ReviewState extends PersistedState {
  role: Role
  selectedParagraphId: string
  commentFilter: 'all' | 'open' | 'suggestion' | 'duplicate'
  revisionMode: boolean
  dirty: boolean
  online: boolean
  weakNetwork: boolean
  syncing: boolean
  lastError: string | null
  past: { paragraphs: Paragraph[]; comments: Comment[]; versions: Version[] }[]
  future: { paragraphs: Paragraph[]; comments: Comment[]; versions: Version[] }[]
  setRole: (role: Role) => void
  selectParagraph: (id: string) => void
  setCommentFilter: (filter: ReviewState['commentFilter']) => void
  setRevisionMode: (value: boolean) => void
  updateParagraph: (id: string, text: string) => void
  addComment: (input: Pick<Comment, 'paragraphId' | 'type' | 'quote' | 'body' | 'suggestion'>) => void
  replyComment: (commentId: string, body: string) => void
  resolveSuggestion: (commentId: string, accepted: boolean) => void
  mergeComment: (commentId: string, targetId: string) => void
  toggleLock: (paragraphId: string) => void
  createVersion: (label: string) => void
  undo: () => void
  redo: () => void
  save: () => void
  resetDemo: () => void
  // 本地待提交队列与对账
  setOnline: (online: boolean) => void
  setWeakNetworkMode: (enabled: boolean) => void
  syncNow: (silent?: boolean) => Promise<SyncSummary | null>
  resolveQueueConflict: (changeId: string, choice: 'local' | 'remote') => void
  retryQueuedChange: (changeId: string) => void
  removeQueuedChange: (changeId: string) => void
  clearSentQueue: () => void
  restoreShelfVersion: (shelfId: string) => void
  removeShelfVersion: (shelfId: string) => void
  simulateRemoteParagraphEdit: (paragraphId: string) => string | null
  simulateRemoteParagraphLock: (paragraphId: string, locked: boolean) => void
  simulateRemoteCommentMerge: (commentId: string, targetId: string) => void
}

export const useReviewStore = create<ReviewState>((set, get) => {
  const persist = () => persistDraft({
    paragraphs: get().paragraphs,
    comments: get().comments,
    versions: get().versions,
    queue: get().queue,
    shelf: get().shelf,
    serverRefs: get().serverRefs,
    lastSyncAt: get().lastSyncAt,
  })

  // 可撤销的写操作；队列等同步状态一并持久化，但不进撤销栈
  const record = (producer: (state: ReviewState) => Partial<ReviewState>) => set((state) => {
    const history = { paragraphs: clone(state.paragraphs), comments: clone(state.comments), versions: clone(state.versions) }
    const next = producer(state)
    const merged = { ...state, ...next }
    persistDraft({
      paragraphs: merged.paragraphs,
      comments: merged.comments,
      versions: merged.versions,
      queue: merged.queue,
      shelf: merged.shelf,
      serverRefs: merged.serverRefs,
      lastSyncAt: merged.lastSyncAt,
    })
    return { ...next, past: [...state.past.slice(-49), history], future: [], dirty: true }
  })

  // 同一段落的连续编辑合并成一个队列条目；从冲突状态继续编辑时，远端候选版先进落选存档
  const upsertParagraphEdit = (state: ReviewState, paragraphId: string, text: string, authorOverride?: string): [QueuedChange[], ShelvedVersion[]] => {
    const now = Date.now()
    const existing = state.queue.find((item) =>
      item.kind === 'paragraph-edit' && item.paragraphId === paragraphId && ACTIVE_STATUSES.has(item.status))
    if (existing) {
      const shelvedFromConflict: ShelvedVersion[] = existing.status === 'conflict' && existing.remoteText !== undefined
        ? [{
            id: newId('shelf'), kind: 'paragraph-edit', paragraphId,
            paragraphNumber: state.paragraphs.find((p) => p.id === paragraphId)?.number ?? '',
            text: existing.remoteText, source: 'remote', author: existing.remoteAuthor ?? '远端协作者', createdAt: now,
          }, ...state.shelf]
        : state.shelf
      return [
        state.queue.map((item) => item.id === existing.id ? {
          ...item,
          text,
          status: 'queued' as const,
          attempts: 0,
          lastError: undefined,
          blockReason: undefined,
          blockDetail: undefined,
          baseRevision: existing.remoteRevision ?? item.baseRevision,
          baseContentRevision: existing.remoteContentRevision ?? item.baseContentRevision,
          remoteText: undefined,
          remoteAuthor: undefined,
          remoteRevision: undefined,
          remoteContentRevision: undefined,
          updatedAt: now,
        } : item),
        shelvedFromConflict,
      ]
    }
    const entry: QueuedChange = {
      id: newId('queue'),
      kind: 'paragraph-edit',
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      author: authorOverride ?? authorNameForRole(state.role),
      role: state.role,
      attempts: 0,
      paragraphId,
      text,
      baseRevision: state.serverRefs.paragraphs[paragraphId]?.revision,
      baseContentRevision: state.serverRefs.paragraphs[paragraphId]?.contentRevision,
    }
    return [[entry, ...state.queue], state.shelf]
  }

  return {
    role: 'reviewer',
    paragraphs: initialParagraphs,
    comments: initialComments,
    versions: initialVersions,
    queue: initialQueue,
    shelf: initialShelf,
    serverRefs: initialRefs,
    lastSyncAt: (parsed?.lastSyncAt ?? null) as number | null,
    selectedParagraphId: 'p-02',
    commentFilter: 'all',
    revisionMode: false,
    dirty: false,
    online: true,
    weakNetwork: false,
    syncing: false,
    lastError: null,
    past: [],
    future: [],

    setRole: (role) => set({ role, selectedParagraphId: get().paragraphs[0]?.id ?? '' }),
    selectParagraph: (selectedParagraphId) => set({ selectedParagraphId }),
    setCommentFilter: (commentFilter) => set({ commentFilter }),
    setRevisionMode: (revisionMode) => set({ revisionMode }),

    updateParagraph: (paragraphId, text) => {
      const paragraph = get().paragraphs.find((item) => item.id === paragraphId)
      if (!paragraph || paragraph.status === 'locked') return
      record((state) => {
        const [nextQueue, nextShelf] = upsertParagraphEdit(state, paragraphId, text)
        return {
          paragraphs: state.paragraphs.map((item) => item.id === paragraphId
            ? { ...item, text, status: 'open' as const, highlighted: true }
            : item),
          queue: nextQueue,
          shelf: nextShelf,
        }
      })
    },

    addComment: (input) => record((state) => {
      const commentId = newId('comment')
      const comment: Comment = {
        ...input,
        id: commentId,
        author: authorNameForRole(state.role),
        role: state.role,
        status: 'open',
        replies: [],
        createdAt: Date.now(),
      }
      const entry: QueuedChange = {
        id: commentId,
        kind: 'comment-add',
        status: 'queued',
        createdAt: comment.createdAt,
        updatedAt: comment.createdAt,
        author: comment.author,
        role: state.role,
        attempts: 0,
        comment: {
          paragraphId: comment.paragraphId, type: comment.type, quote: comment.quote, body: comment.body,
          suggestion: comment.suggestion, author: comment.author, role: comment.role,
          status: comment.status, replies: [], createdAt: comment.createdAt,
        },
      }
      return { comments: [comment, ...state.comments], queue: [entry, ...state.queue] }
    }),

    replyComment: (commentId, body) => record((state) => {
      const target = state.comments.find((comment) => comment.id === commentId)
      if (!target) return {}
      const now = Date.now()
      const replyId = newId('reply')
      const reply: Reply = { id: replyId, author: authorNameForRole(state.role), role: state.role, body, createdAt: now }
      const entry: QueuedChange = {
        id: replyId,
        kind: 'comment-reply',
        status: 'queued',
        createdAt: now,
        updatedAt: now,
        author: reply.author,
        role: state.role,
        attempts: 0,
        commentId,
        reply: { author: reply.author, role: reply.role, body, createdAt: now },
      }
      return {
        comments: state.comments.map((comment) => comment.id === commentId
          ? { ...comment, replies: [...comment.replies, reply] }
          : comment),
        queue: [entry, ...state.queue],
      }
    }),

    resolveSuggestion: (commentId, accepted) => record((state) => {
      const comment = state.comments.find((item) => item.id === commentId)
      const acceptedText = accepted && comment?.suggestion ? comment.suggestion : undefined
      let queue = state.queue
      let shelf = state.shelf
      if (acceptedText && comment) {
        ;[queue, shelf] = upsertParagraphEdit(state, comment.paragraphId, acceptedText, '作者')
      }
      return {
        comments: state.comments.map((item) => item.id === commentId ? { ...item, status: accepted ? 'accepted' : 'rejected' } : item),
        paragraphs: acceptedText && comment
          ? state.paragraphs.map((paragraph) => paragraph.id === comment.paragraphId
              ? { ...paragraph, text: acceptedText, status: 'accepted' }
              : paragraph)
          : state.paragraphs,
        queue,
        shelf,
      }
    }),

    mergeComment: (commentId, targetId) => record((state) => {
      const now = Date.now()
      const entry: QueuedChange = {
        id: newId('queue'),
        kind: 'comment-merge',
        status: 'queued',
        createdAt: now,
        updatedAt: now,
        author: authorNameForRole(state.role),
        role: state.role,
        attempts: 0,
        commentId,
        targetCommentId: targetId,
      }
      return {
        comments: state.comments.map((comment) => comment.id === commentId
          ? { ...comment, status: 'merged' as const, mergedInto: targetId }
          : comment),
        queue: [entry, ...state.queue],
      }
    }),

    toggleLock: (paragraphId) => record((state) => {
      const paragraph = state.paragraphs.find((item) => item.id === paragraphId)
      if (!paragraph) return {}
      const locked = paragraph.status !== 'locked'
      const now = Date.now()
      const entry: QueuedChange = {
        id: newId('queue'),
        kind: 'paragraph-lock',
        status: 'queued',
        createdAt: now,
        updatedAt: now,
        author: authorNameForRole(state.role),
        role: state.role,
        attempts: 0,
        paragraphId,
        locked,
        baseRevision: state.serverRefs.paragraphs[paragraphId]?.revision,
      }
      return {
        paragraphs: state.paragraphs.map((item) => item.id === paragraphId
          ? { ...item, status: locked ? 'locked' as const : 'accepted' as const }
          : item),
        queue: [entry, ...state.queue],
      }
    }),

    createVersion: (label) => record((state) => ({
      versions: [{ id: newId('version'), label: label.trim() || `版本 ${state.versions.length + 1}`, createdAt: Date.now(), paragraphs: clone(state.paragraphs) }, ...state.versions],
    })),

    undo: () => set((state) => {
      const previous = state.past.at(-1)
      if (!previous) return state
      const current = { paragraphs: clone(state.paragraphs), comments: clone(state.comments), versions: clone(state.versions) }
      persistDraft({ ...state, ...previous })
      return { ...previous, past: state.past.slice(0, -1), future: [current, ...state.future], dirty: true }
    }),
    redo: () => set((state) => {
      const next = state.future[0]
      if (!next) return state
      const current = { paragraphs: clone(state.paragraphs), comments: clone(state.comments), versions: clone(state.versions) }
      persistDraft({ ...state, ...next })
      return { ...next, past: [...state.past, current], future: state.future.slice(1), dirty: true }
    }),
    save: () => {
      persist()
      set({ dirty: false })
    },
    resetDemo: () => {
      resetRemote()
      localStorage.removeItem(DRAFT_KEY)
      set({
        paragraphs: clone(baseParagraphs),
        comments: clone(baseComments),
        versions: clone(baseVersions),
        queue: [],
        shelf: [],
        serverRefs: buildInitialRefs(),
        lastSyncAt: null,
        past: [],
        future: [],
        dirty: false,
        lastError: null,
        online: true,
        weakNetwork: false,
        syncing: false,
      })
      setRemoteOnline(true)
      setWeakNetwork(false)
    },

    setOnline: (online) => {
      set({ online })
      setRemoteOnline(online)
      if (online) void get().syncNow(true)
    },
    setWeakNetworkMode: (enabled) => {
      set({ weakNetwork: enabled })
      setWeakNetwork(enabled)
    },

    syncNow: async (silent = false) => {
      const current = get()
      if (current.syncing) return null
      if (!current.online) {
        if (!silent) set({ lastError: '当前处于断网状态，改动已攒在本地队列' })
        return null
      }
      set({ syncing: true, lastError: null })
      const summary: SyncSummary = { sent: 0, failed: 0, blocked: 0, conflicts: 0, pulled: 0 }
      // 只有在处理“服务端已合并意见”这类退回时才额外取一次远端状态
      let lazySnapshot: RemoteSnapshotLike | null = null
      const getLazySnapshot = async (): Promise<RemoteSnapshotLike> => {
        if (!lazySnapshot) lazySnapshot = await fetchRemoteSnapshot()
        return lazySnapshot
      }

      // 1) 推送队列：只送 queued / failed 的条目；blocked、conflict 等作者处理，sent 不重发
      const pending = get().queue
        .filter((item) => item.status === 'queued' || item.status === 'failed')
        .sort((a, b) => pushRank[a.kind] - pushRank[b.kind] || a.createdAt - b.createdAt)

      for (const item of pending) {
        // 重发前重新从队列取最新状态（冲突中作者又编辑过的情况）
        const live = get().queue.find((q) => q.id === item.id)
        if (!live || (live.status !== 'queued' && live.status !== 'failed')) continue
        set((state) => ({
          queue: state.queue.map((q) => q.id === item.id ? { ...q, status: 'sending' as const } : q),
        }))
        persist()
        try {
          const outcome = await pushQueuedChange({ ...live, status: 'sending' })
          if (outcome.result === 'sent') {
            summary.sent += 1
            set((state) => ({
              queue: state.queue.map((q) => q.id === item.id ? {
                ...q, status: 'sent' as const, attempts: q.attempts + 1, lastError: undefined,
                blockReason: undefined, blockDetail: undefined, updatedAt: Date.now(),
              } : q),
              serverRefs: {
                ...state.serverRefs,
                paragraphs: item.paragraphId && (item.kind === 'paragraph-edit' || item.kind === 'paragraph-lock')
                  ? (() => {
                      const previous = state.serverRefs.paragraphs[item.paragraphId]
                      const nextRef: RemoteParagraphRef = {
                        text: item.kind === 'paragraph-edit' ? (item.text ?? previous?.text ?? '') : (previous?.text ?? ''),
                        status: item.kind === 'paragraph-lock'
                          ? (item.locked ? 'locked' : 'accepted') as Paragraph['status']
                          : (previous?.status ?? 'open'),
                        revision: outcome.revision,
                        contentRevision: outcome.contentRevision ?? previous?.contentRevision ?? outcome.revision,
                        editor: item.author,
                      }
                      return { ...state.serverRefs.paragraphs, [item.paragraphId as string]: nextRef }
                    })()
                  : state.serverRefs.paragraphs,
              },
            }))
          } else if (outcome.result === 'conflict') {
            summary.conflicts += 1
            set((state) => ({
              queue: state.queue.map((q) => q.id === item.id ? {
                ...q, status: 'conflict' as const, remoteText: outcome.remoteText,
                remoteAuthor: outcome.remoteAuthor, remoteRevision: outcome.remoteRevision,
                remoteContentRevision: outcome.remoteContentRevision, updatedAt: Date.now(),
              } : q),
            }))
          } else {
            summary.blocked += 1
            // 远端已合并别人意见：本地把对应意见也同步成“已合并”，回复留在队列等作者决定
            let remoteComment: { status: Comment['status']; mergedInto?: string } | undefined
            if (outcome.reason === 'comment-merged' && item.kind === 'comment-reply' && item.commentId) {
              try {
                remoteComment = (await getLazySnapshot()).comments[item.commentId]
              } catch {
                // 取不到远端状态也不影响退回
              }
            }
            set((state) => ({
              queue: state.queue.map((q) => q.id === item.id ? {
                ...q, status: 'blocked' as const, blockReason: outcome.reason, blockDetail: outcome.detail, updatedAt: Date.now(),
              } : q),
              comments: remoteComment?.status === 'merged' && item.commentId
                ? state.comments.map((comment) => comment.id === item.commentId
                    ? { ...comment, status: 'merged' as const, mergedInto: remoteComment?.mergedInto ?? comment.mergedInto }
                    : comment)
                : state.comments,
            }))
          }
          persist()
        } catch (error) {
          // 中途失败：条目留在队列里，下一次只补没送成功的
          summary.failed += 1
          const messageText = error instanceof Error ? error.message : '网络异常'
          set((state) => ({
            queue: state.queue.map((q) => q.id === item.id ? {
              ...q, status: 'failed' as const, attempts: q.attempts + 1, lastError: messageText, updatedAt: Date.now(),
            } : q),
            lastError: messageText,
          }))
          persist()
        }
      }

      // 2) 拉取服务端快照，逐段对账：本地没有待处理改动的段落直接采用远端新版本
      try {
        const snapshot = lazySnapshot ?? await fetchRemoteSnapshot()
        set((state) => {
          const pendingParagraphs = new Set(state.queue
            .filter((q) => (q.kind === 'paragraph-edit' || q.kind === 'paragraph-lock') && q.status !== 'sent')
            .map((q) => q.paragraphId))
          const pendingMerges = new Set(state.queue
            .filter((q) => q.kind === 'comment-merge' && q.status !== 'sent')
            .map((q) => q.commentId))

          const paragraphs = state.paragraphs.map((paragraph) => {
            const remote = snapshot.paragraphs[paragraph.id]
            const localRef = state.serverRefs.paragraphs[paragraph.id]
            if (!remote) return paragraph
            if (pendingParagraphs.has(paragraph.id)) return paragraph
            const contentChanged = !localRef || remote.contentRevision > (localRef.contentRevision ?? localRef.revision)
            const statusChanged = !localRef || remote.status !== localRef.status
            if (!contentChanged && !statusChanged) return paragraph
            summary.pulled += 1
            return {
              ...paragraph,
              text: contentChanged ? remote.text : paragraph.text,
              status: statusChanged || contentChanged ? remote.status : paragraph.status,
              highlighted: contentChanged ? true : paragraph.highlighted,
            }
          })

          const comments = state.comments.map((comment) => {
            const remote = snapshot.comments[comment.id]
            const localRef = state.serverRefs.comments[comment.id]
            if (!remote || pendingMerges.has(comment.id)) return comment
            if (localRef && remote.status === localRef.status && remote.mergedInto === localRef.mergedInto) return comment
            summary.pulled += 1
            return { ...comment, status: remote.status, mergedInto: remote.mergedInto }
          })

          // 服务端又往前改过：刷新冲突条目上展示的远端版本
          const queue = state.queue.map((item) => {
            if (item.status !== 'conflict' || item.kind !== 'paragraph-edit' || !item.paragraphId) return item
            const remote = snapshot.paragraphs[item.paragraphId]
            if (remote && remote.contentRevision > (item.remoteContentRevision ?? 0)) {
              return { ...item, remoteText: remote.text, remoteAuthor: remote.editor, remoteRevision: remote.revision, remoteContentRevision: remote.contentRevision }
            }
            return item
          })

          const serverRefs = {
            paragraphs: Object.fromEntries(Object.entries(snapshot.paragraphs).map(([key, value]) => [key, { ...value }])),
            comments: Object.fromEntries(Object.entries(snapshot.comments).map(([key, value]) => [key, { status: value.status, mergedInto: value.mergedInto }])),
          }
          return { paragraphs, comments, queue, serverRefs, lastSyncAt: Date.now() }
        })
        persist()
      } catch (error) {
        const messageText = error instanceof Error ? error.message : '拉取远端状态失败'
        set({ lastError: messageText })
      }

      // 失败的段落都补齐了，就清掉上次的错误提示
      if (summary.failed === 0) set({ lastError: null })
      set({ syncing: false })
      return summary
    },

    resolveQueueConflict: (changeId, choice) => {
      const entry = get().queue.find((item) => item.id === changeId)
      if (!entry || entry.status !== 'conflict' || entry.kind !== 'paragraph-edit' || !entry.paragraphId) return
      record((state) => {
        const now = Date.now()
        const number = state.paragraphs.find((paragraph) => paragraph.id === entry.paragraphId)?.number ?? ''
        const loser: ShelvedVersion = {
          id: newId('shelf'),
          kind: 'paragraph-edit',
          paragraphId: entry.paragraphId as string,
          paragraphNumber: number,
          text: choice === 'local' ? (entry.remoteText ?? '') : (entry.text ?? ''),
          source: choice === 'local' ? 'remote' : 'local',
          author: choice === 'local' ? (entry.remoteAuthor ?? '远端协作者') : entry.author,
          createdAt: now,
        }
        if (choice === 'local') {
          // 本地版重新入队，基准修订号对齐远端，再送一次完成覆盖
          return {
            shelf: [loser, ...state.shelf],
            queue: state.queue.map((item) => item.id === changeId ? {
              ...item,
              status: 'queued' as const,
              baseRevision: entry.remoteRevision,
              baseContentRevision: entry.remoteContentRevision,
              remoteText: undefined,
              remoteAuthor: undefined,
              remoteRevision: undefined,
              remoteContentRevision: undefined,
              blockReason: undefined,
              blockDetail: undefined,
              lastError: undefined,
              attempts: 0,
              updatedAt: now,
            } : item),
          }
        }
        return {
          shelf: [loser, ...state.shelf],
          paragraphs: state.paragraphs.map((paragraph) => paragraph.id === entry.paragraphId
            ? { ...paragraph, text: entry.remoteText ?? paragraph.text, highlighted: true }
            : paragraph),
          queue: state.queue.map((item) => item.id === changeId ? {
            ...item,
            status: 'sent' as const,
            text: entry.remoteText,
            remoteText: undefined,
            remoteAuthor: undefined,
            updatedAt: now,
          } : item),
        }
      })
      if (choice === 'local' && get().online) void get().syncNow(true)
    },

    retryQueuedChange: (changeId) => {
      set((state) => ({
        queue: state.queue.map((item) => item.id === changeId && (item.status === 'blocked' || item.status === 'failed' || item.status === 'conflict')
          ? { ...item, status: 'queued' as const, lastError: undefined, blockReason: undefined, blockDetail: undefined, updatedAt: Date.now() }
          : item),
      }))
      persist()
      if (get().online) void get().syncNow(true)
    },

    removeQueuedChange: (changeId) => {
      set((state) => ({ queue: state.queue.filter((item) => item.id !== changeId) }))
      persist()
    },

    clearSentQueue: () => {
      set((state) => ({ queue: state.queue.filter((item) => item.status !== 'sent') }))
      persist()
    },

    restoreShelfVersion: (shelfId) => {
      const stored = get().shelf.find((item) => item.id === shelfId)
      if (!stored) return
      record((state) => {
        const locked = state.paragraphs.find((paragraph) => paragraph.id === stored.paragraphId)?.status === 'locked'
        const now = Date.now()
        const [nextQueue] = locked
          ? [[{
              id: newId('queue'), kind: 'paragraph-edit' as const, status: 'blocked' as const,
              blockReason: 'paragraph-locked' as const, blockDetail: '段落仍被编辑锁定，解锁后可重试',
              createdAt: now, updatedAt: now, author: stored.author, role: 'author' as Role,
              attempts: 0, paragraphId: stored.paragraphId, text: stored.text,
              baseRevision: state.serverRefs.paragraphs[stored.paragraphId]?.revision,
              baseContentRevision: state.serverRefs.paragraphs[stored.paragraphId]?.contentRevision,
            }, ...state.queue], state.shelf]
          : upsertParagraphEdit(state, stored.paragraphId, stored.text, stored.author)
        return {
          paragraphs: locked
            ? state.paragraphs
            : state.paragraphs.map((paragraph) => paragraph.id === stored.paragraphId
                ? { ...paragraph, text: stored.text, highlighted: true }
                : paragraph),
          queue: nextQueue,
          shelf: state.shelf.filter((item) => item.id !== shelfId),
        }
      })
      if (get().online) void get().syncNow(true)
    },

    removeShelfVersion: (shelfId) => {
      set((state) => ({ shelf: state.shelf.filter((item) => item.id !== shelfId) }))
      persist()
    },

    simulateRemoteParagraphEdit: (paragraphId) => {
      const paragraph = get().paragraphs.find((item) => item.id === paragraphId)
      if (!paragraph) return null
      const text = simulateRemoteEdit(paragraph)
      if (get().online) void get().syncNow(true)
      return text
    },
    simulateRemoteParagraphLock: (paragraphId, locked) => {
      const paragraph = get().paragraphs.find((item) => item.id === paragraphId)
      if (!paragraph) return
      simulateRemoteLock(paragraph, locked)
      if (get().online) void get().syncNow(true)
    },
    simulateRemoteCommentMerge: (commentId, targetId) => {
      const comment = get().comments.find((item) => item.id === commentId)
      if (!comment) return
      simulateRemoteMerge(comment, targetId)
      if (get().online) void get().syncNow(true)
    },
  }
})
