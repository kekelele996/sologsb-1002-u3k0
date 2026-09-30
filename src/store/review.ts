import { create } from 'zustand'
import { resolveConflictOnServer, resetMockServer, setMockFailRandom, setNetworkOnline as setMockNetwork, syncItems } from '../services/mockApi'
import type { SyncResult } from '../services/mockApi'
import type { ArchivedVersion, Comment, EditConflict, Paragraph, QueueItem, Reply, Role, Version } from '../types'

const DRAFT_KEY = 'sologsb-1002-draft-v1'
const QUEUE_KEY = 'sologsb-1002-queue-v1'
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const baseParagraphs: Paragraph[] = [
  { id: 'p-01', section: '摘要', number: '1.', text: '开源软件供应链的稳定性不仅取决于代码质量，也取决于维护者能否持续识别并回应社区需求。', original: '开源软件供应链的稳定性不仅取决于代码质量，也取决于维护者能否持续识别并回应社区需求。', status: 'accepted', highlighted: false },
  { id: 'p-02', section: '1 引言', number: '2.', text: '近年来，大型语言模型被广泛用于代码生成与缺陷定位，但其在真实维护工作流中的影响仍缺少系统证据。', original: '近年来，大型语言模型被广泛用于代码生成与缺陷定位，但其在真实维护工作流中的影响仍缺少系统证据。', status: 'open', highlighted: true },
  { id: 'p-03', section: '1 引言', number: '3.', text: '本文收集 12 个活跃开源项目连续 18 个月的议题记录，并访谈 26 位核心维护者。', original: '本文收集 12 个活跃开源项目连续 18 个月的议题记录，并访谈 26 位核心维护者。', status: 'open', highlighted: true },
  { id: 'p-04', section: '2 方法', number: '4.', text: '我们采用混合研究方法，将议题生命周期划分为响应、评审与合并三个阶段。编码过程由两名研究者独立完成。', original: '我们采用混合研究方法，将议题生命周期划分为响应、评审与合并三个阶段。编码过程由两名研究者独立完成。', status: 'open', highlighted: false },
  { id: 'p-05', section: '2 方法', number: '5.', text: '当编码结果不一致时，研究者通过讨论达成一致；若仍有分歧，则邀请第三位研究者裁决。', original: '当编码结果不一致时，研究者通过讨论达成一致；若仍有分歧，则邀请第三位研究者裁决。', status: 'accepted', highlighted: true },
  { id: 'p-06', section: '3 结果', number: '6.', text: '初步结果显示，辅助工具缩短了首次响应时间，但没有显著降低维护者处理复杂议题的认知负担。', original: '初步结果显示，辅助工具缩短了首次响应时间，但没有显著降低维护者处理复杂议题的认知负担。', status: 'open', highlighted: true },
  { id: 'p-07', section: '3 结果', number: '7.', text: '在高活跃度项目中，维护者更关注建议是否可验证，而非建议生成速度。', original: '在高活跃度项目中，维护者更关注建议是否可验证，而非建议生成速度。', status: 'open', highlighted: false },
]
const baseComments: Comment[] = [
  { id: 'c-01', paragraphId: 'p-02', author: '审稿人 A', role: 'reviewer', type: 'suggestion', quote: '其真实维护工作流中的影响', body: '建议把“影响”具体化为可观察指标。', suggestion: '近年来，大型语言模型被广泛用于代码生成与缺陷定位，但在真实维护工作流中究竟改变了哪些协作行为，仍缺少系统证据。', status: 'open', replies: [{ id: 'r-01', author: '作者', role: 'author', body: '可以，修改后会补充指标定义。', createdAt: Date.now() - 7200000 }], createdAt: Date.now() - 86400000 },
  { id: 'c-02', paragraphId: 'p-02', author: '审稿人 B', role: 'reviewer', type: 'comment', quote: '缺少系统证据', body: '这里的“系统证据”范围过大，建议限定为本研究覆盖的议题语料。', status: 'open', replies: [], createdAt: Date.now() - 64000000 },
  { id: 'c-03', paragraphId: 'p-03', author: '审稿人 A', role: 'reviewer', type: 'comment', quote: '26 位核心维护者', body: '请说明抽样方式和地域分布，避免样本选择偏差。', status: 'open', replies: [], createdAt: Date.now() - 54000000 },
  { id: 'c-04', paragraphId: 'p-04', author: '审稿人 C', role: 'reviewer', type: 'comment', quote: '两名研究者独立完成', body: '建议报告编码者间一致性系数，并明确不一致处理规则。', status: 'open', replies: [], createdAt: Date.now() - 48000000 },
  { id: 'c-05', paragraphId: 'p-05', author: '审稿人 D', role: 'reviewer', type: 'comment', quote: '邀请第三位研究者裁决', body: '与上一段重复：都在说明编码分歧如何解决，建议合并意见。', status: 'open', replies: [], createdAt: Date.now() - 43000000 },
  { id: 'c-06', paragraphId: 'p-06', author: '审稿人 B', role: 'reviewer', type: 'suggestion', quote: '但没有显著降低维护者处理复杂议题的认知负担', body: '“显著”需要给出统计检验与效应量。', suggestion: '初步结果显示，辅助工具缩短了首次响应时间，但对复杂议题处理时长与自我报告认知负担均未产生统计显著影响。', status: 'open', replies: [], createdAt: Date.now() - 36000000 },
]

const readJSON = <T,>(key: string): T | null => {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

const seed = readJSON<Partial<{ paragraphs: Paragraph[]; comments: Comment[]; versions: Version[] }>>(DRAFT_KEY)
const initialParagraphs = seed?.paragraphs?.length ? seed.paragraphs : baseParagraphs
const initialComments = seed?.comments ?? baseComments
const initialVersions: Version[] = seed?.versions ?? [
  { id: 'v-01', label: '投稿初稿 v1', createdAt: Date.now() - 1209600000, paragraphs: JSON.parse(JSON.stringify(baseParagraphs)) as Paragraph[] },
  { id: 'v-02', label: '审阅基线 v2', createdAt: Date.now() - 172800000, paragraphs: JSON.parse(JSON.stringify(baseParagraphs.map((p) => p.id === 'p-04' ? { ...p, text: `${p.text} 编码规则在预注册方案中说明。` } : p))) as Paragraph[] },
]

const queueSeed = readJSON<{ queue?: QueueItem[]; archives?: ArchivedVersion[] }>(QUEUE_KEY)
const initialQueue: QueueItem[] = Array.isArray(queueSeed?.queue) ? (queueSeed?.queue as QueueItem[]) : []
const initialArchives: ArchivedVersion[] = Array.isArray(queueSeed?.archives) ? (queueSeed?.archives as ArchivedVersion[]) : []

const persistDraft = (paragraphs: Paragraph[], comments: Comment[], versions: Version[]) => {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ paragraphs, comments, versions }))
}
const persistQueue = (queue: QueueItem[], archives: ArchivedVersion[]) => {
  localStorage.setItem(QUEUE_KEY, JSON.stringify({ queue, archives }))
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** 同步结果汇总，供界面提示 */
export interface SyncSummary {
  accepted: number
  conflict: number
  rejected: number
  failed: number
}

interface ReviewState {
  role: Role
  paragraphs: Paragraph[]
  comments: Comment[]
  versions: Version[]
  selectedParagraphId: string
  commentFilter: 'all' | 'open' | 'suggestion' | 'duplicate'
  revisionMode: boolean
  dirty: boolean
  conflicts: EditConflict[]
  queue: QueueItem[]
  archives: ArchivedVersion[]
  networkOnline: boolean
  syncing: boolean
  failRandom: boolean
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
  addConflict: (conflict: EditConflict) => void
  resolveConflict: (conflictId: string, strategy: 'local' | 'remote') => void
  dismissConflict: (conflictId: string) => void
  locateConflict: (conflictId: string) => void
  enqueueParagraphEdit: (paragraphId: string, baseText: string, localText: string) => void
  enqueueComment: (localId: string, input: Pick<Comment, 'paragraphId' | 'type' | 'quote' | 'body' | 'suggestion'>) => void
  enqueueReply: (replyId: string, commentId: string, paragraphId: string, body: string) => void
  setNetworkOnline: (online: boolean) => void
  setFailRandom: (value: boolean) => void
  syncQueue: () => Promise<SyncSummary | undefined>
  retryQueueItem: (itemId: string) => Promise<void>
  rebaseQueueItem: (itemId: string) => Promise<void>
  discardQueueItem: (itemId: string) => void
  clearSucceeded: () => void
  restoreArchive: (archiveId: string) => void
  undo: () => void
  redo: () => void
  save: () => void
  resetDemo: () => void
}

export const useReviewStore = create<ReviewState>((set, get) => {
  const record = (producer: (state: ReviewState) => Partial<ReviewState>) => set((state) => {
    const history = { paragraphs: clone(state.paragraphs), comments: clone(state.comments), versions: clone(state.versions) }
    const next = producer(state)
    const paragraphs = next.paragraphs ?? state.paragraphs
    const comments = next.comments ?? state.comments
    const versions = next.versions ?? state.versions
    persistDraft(paragraphs, comments, versions)
    return { ...next, past: [...state.past.slice(-49), history], future: [], dirty: true }
  })

  const authorLabel = () => get().role === 'reviewer' ? '审稿人 A' : get().role === 'author' ? '作者' : '编辑'

  return {
    role: 'reviewer',
    paragraphs: initialParagraphs,
    comments: initialComments,
    versions: initialVersions,
    selectedParagraphId: 'p-02',
    commentFilter: 'all',
    revisionMode: false,
    dirty: false,
    conflicts: [],
    queue: initialQueue,
    archives: initialArchives,
    networkOnline: true,
    syncing: false,
    failRandom: false,
    past: [],
    future: [],
    setRole: (role) => set({ role, selectedParagraphId: get().paragraphs[0]?.id ?? '' }),
    selectParagraph: (selectedParagraphId) => set({ selectedParagraphId }),
    setCommentFilter: (commentFilter) => set({ commentFilter }),
    setRevisionMode: (revisionMode) => set({ revisionMode }),
    updateParagraph: (paragraphId, text) => {
      // 基准文本在落本地前取定，作为三段对账的 base
      const baseText = get().paragraphs.find((paragraph) => paragraph.id === paragraphId)?.text ?? text
      record((state) => ({
        paragraphs: state.paragraphs.map((paragraph) => paragraph.id === paragraphId && paragraph.status !== 'locked'
          ? { ...paragraph, text, status: 'open' as const, highlighted: true }
          : paragraph),
      }))
      get().enqueueParagraphEdit(paragraphId, baseText, text)
    },
    addComment: (input) => {
      const localId = id('comment')
      record((state) => ({
        comments: [{
          ...input,
          id: localId,
          author: authorLabel(),
          role: state.role,
          status: 'open',
          replies: [],
          createdAt: Date.now(),
        }, ...state.comments],
      }))
      get().enqueueComment(localId, input)
    },
    replyComment: (commentId, body) => {
      const replyId = id('reply')
      const paragraphId = get().comments.find((comment) => comment.id === commentId)?.paragraphId ?? ''
      record((state) => ({
        comments: state.comments.map((comment) => comment.id === commentId ? {
          ...comment,
          replies: [...comment.replies, { id: replyId, author: authorLabel(), role: state.role, body, createdAt: Date.now() } as Reply],
        } : comment),
      }))
      get().enqueueReply(replyId, commentId, paragraphId, body)
    },
    resolveSuggestion: (commentId, accepted) => {
      const comment = get().comments.find((item) => item.id === commentId)
      const target = comment?.suggestion && accepted ? get().paragraphs.find((paragraph) => paragraph.id === comment.paragraphId) : undefined
      const baseText = target?.text
      record((state) => {
        const suggestion = state.comments.find((item) => item.id === commentId)
        const paragraph = suggestion?.suggestion && accepted
          ? state.paragraphs.find((item) => item.id === suggestion.paragraphId)
          : undefined
        return {
          comments: state.comments.map((item) => item.id === commentId ? { ...item, status: accepted ? 'accepted' : 'rejected' } : item),
          paragraphs: paragraph && suggestion
            ? state.paragraphs.map((item) => item.id === suggestion.paragraphId ? { ...item, text: suggestion.suggestion as string, status: 'accepted' } : item)
            : state.paragraphs,
        }
      })
      // 接受建议会改正文，同样进入待提交队列与远端对账
      if (target && baseText !== undefined && comment?.suggestion) {
        get().enqueueParagraphEdit(target.id, baseText, comment.suggestion)
      }
    },
    mergeComment: (commentId, targetId) => record((state) => ({
      comments: state.comments.map((comment) => comment.id === commentId ? { ...comment, status: 'merged', mergedInto: targetId } : comment),
    })),
    toggleLock: (paragraphId) => record((state) => ({
      paragraphs: state.paragraphs.map((paragraph) => paragraph.id === paragraphId ? {
        ...paragraph,
        status: paragraph.status === 'locked' ? 'accepted' : 'locked',
      } : paragraph),
    })),
    createVersion: (label) => record((state) => ({
      versions: [{ id: id('version'), label: label.trim() || `版本 ${state.versions.length + 1}`, createdAt: Date.now(), paragraphs: clone(state.paragraphs) }, ...state.versions],
    })),
    addConflict: (conflict) => set((state) => ({ conflicts: [conflict, ...state.conflicts] })),
    resolveConflict: (conflictId, strategy) => {
      const conflict = get().conflicts.find((item) => item.id === conflictId)
      if (!conflict) return
      record((state) => ({
        paragraphs: strategy === 'remote'
          ? state.paragraphs.map((paragraph) => paragraph.id === conflict.paragraphId ? { ...paragraph, text: conflict.remoteText, highlighted: true, status: 'open' as const } : paragraph)
          : state.paragraphs,
        conflicts: state.conflicts.filter((item) => item.id !== conflictId),
      }))
      // 落选版本存入存档，可随时找回；队列条目标记对账成功
      set((state) => ({
        archives: [...state.archives, {
          id: id('archive'),
          paragraphId: conflict.paragraphId,
          text: strategy === 'remote' ? conflict.localText : conflict.remoteText,
          source: strategy === 'remote' ? 'local' as const : 'remote' as const,
          reason: strategy === 'remote' ? 'conflict-local' as const : 'conflict-remote' as const,
          conflictId: conflict.id,
          archivedAt: Date.now(),
        }],
        queue: state.queue.map((item) => item.id === conflict.clientItemId
          ? { ...item, status: 'succeeded' as const, lastError: undefined, rejectReason: undefined }
          : item),
      }))
      void resolveConflictOnServer(conflict.paragraphId, strategy, strategy === 'local' ? conflict.localText : undefined)
    },
    dismissConflict: (conflictId) => set((state) => ({ conflicts: state.conflicts.map((conflict) => conflict.id === conflictId ? { ...conflict, dismissed: true } : conflict) })),
    locateConflict: (conflictId) => set((state) => ({ conflicts: state.conflicts.map((conflict) => conflict.id === conflictId ? { ...conflict, dismissed: false } : conflict) })),
    enqueueParagraphEdit: (paragraphId, baseText, localText) => set((state) => {
      // 同一段落的待提交/失败/退回条目合并成一条，避免重复提交
      const existing = state.queue.find((item) => item.kind === 'paragraph' && item.paragraphId === paragraphId && ['pending', 'failed', 'rejected'].includes(item.status))
      if (existing) {
        // 被退回后重新编辑：以当前文本为基准重基；若改回基准文本则撤下条目
        const rebasedBase = existing.status === 'pending' ? existing.payload.baseText : state.paragraphs.find((paragraph) => paragraph.id === paragraphId)?.text
        if (localText === rebasedBase) return { queue: state.queue.filter((item) => item.id !== existing.id) }
        return {
          queue: state.queue.map((item) => item.id === existing.id ? {
            ...item,
            status: 'pending' as const,
            lastError: undefined,
            rejectReason: undefined,
            payload: { ...item.payload, baseText: rebasedBase, localText },
          } : item),
        }
      }
      if (localText === baseText) return {}
      return {
        queue: [...state.queue, {
          id: id('queue'),
          kind: 'paragraph' as const,
          status: 'pending' as const,
          paragraphId,
          createdAt: Date.now(),
          attempts: 0,
          payload: { baseText, localText, author: authorLabel(), role: state.role },
        }],
      }
    }),
    enqueueComment: (localId, input) => set((state) => ({
      queue: [...state.queue, {
        id: id('queue'),
        kind: 'comment' as const,
        status: 'pending' as const,
        paragraphId: input.paragraphId,
        createdAt: Date.now(),
        attempts: 0,
        payload: {
          localId,
          commentType: input.type,
          quote: input.quote,
          body: input.body,
          suggestion: input.suggestion,
          author: authorLabel(),
          role: state.role,
        },
      }],
      comments: state.comments.map((comment) => comment.id === localId ? { ...comment, syncStatus: 'pending' as const } : comment),
    })),
    enqueueReply: (replyId, commentId, paragraphId, body) => set((state) => ({
      queue: [...state.queue, {
        id: id('queue'),
        kind: 'reply' as const,
        status: 'pending' as const,
        paragraphId,
        createdAt: Date.now(),
        attempts: 0,
        payload: { replyId, commentId, paragraphId, body, author: authorLabel(), role: state.role },
      }],
      comments: state.comments.map((comment) => comment.id === commentId ? {
        ...comment,
        replies: comment.replies.map((reply) => reply.id === replyId ? { ...reply, syncStatus: 'pending' as const } : reply),
      } : comment),
    })),
    setNetworkOnline: (online) => {
      set({ networkOnline: online })
      setMockNetwork(online)
      if (online && get().queue.some((item) => item.status === 'pending' || item.status === 'failed')) void get().syncQueue()
    },
    setFailRandom: (value) => {
      set({ failRandom: value })
      setMockFailRandom(value)
    },
    syncQueue: async () => {
      const state = get()
      if (state.syncing) return undefined
      const items = state.queue.filter((item) => item.status === 'pending' || item.status === 'failed')
      if (!items.length) return { accepted: 0, conflict: 0, rejected: 0, failed: 0 }
      set({ syncing: true })
      try {
        const results = await syncItems(items.map((item) => ({
          clientItemId: item.id,
          kind: item.kind,
          paragraphId: item.paragraphId,
          baseText: item.payload.baseText,
          localText: item.payload.localText,
          localId: item.payload.localId,
          commentType: item.payload.commentType,
          quote: item.payload.quote,
          body: item.payload.body,
          suggestion: item.payload.suggestion,
          replyId: item.payload.replyId,
          commentId: item.payload.commentId,
          author: item.payload.author,
          role: item.payload.role,
          attempts: item.attempts,
        })))
        const resultMap = new Map(results.map((result) => [result.clientItemId, result]))
        const summary: SyncSummary = {
          accepted: results.filter((result) => result.status === 'accepted').length,
          conflict: results.filter((result) => result.status === 'conflict').length,
          rejected: results.filter((result) => result.status === 'rejected').length,
          failed: results.filter((result) => result.status === 'failed').length,
        }
        set((state) => {
          const queue = state.queue.map((item) => {
            const result = resultMap.get(item.id)
            if (!result) return item
            if (result.status === 'accepted') return { ...item, status: 'succeeded' as const, attempts: item.attempts + 1, lastError: undefined, rejectReason: undefined }
            if (result.status === 'conflict') return { ...item, status: 'conflict' as const, attempts: item.attempts + 1 }
            if (result.status === 'rejected') return { ...item, status: 'rejected' as const, attempts: item.attempts + 1, lastError: result.message, rejectReason: result.reason }
            return { ...item, status: 'failed' as const, attempts: item.attempts + 1, lastError: result.message }
          })

          // 段落冲突：两边版本都保留，生成待作者选择的冲突卡片
          const newConflicts: EditConflict[] = results
            .filter((result) => result.status === 'conflict')
            .map((result) => {
              const item = state.queue.find((queued) => queued.id === result.clientItemId) as QueueItem
              const remoteText = result.status === 'conflict' ? result.remoteText : ''
              const remoteAuthor = result.status === 'conflict' ? result.remoteAuthor : ''
              return {
                id: `conflict-${result.clientItemId}`,
                paragraphId: item.paragraphId,
                localText: item.payload.localText ?? '',
                remoteText,
                localAuthor: item.payload.author,
                remoteAuthor,
                detectedAt: Date.now(),
                clientItemId: result.clientItemId,
                baseText: item.payload.baseText,
              }
            })
          const conflicts = [...newConflicts, ...state.conflicts.filter((conflict) => !newConflicts.some((item) => item.id === conflict.id))]

          // 批注/回复的同步状态回写到本地意见上
          let comments = state.comments
          for (const item of state.queue) {
            const result = resultMap.get(item.id)
            if (!result) continue
            const syncStatus = result.status === 'accepted' ? undefined : result.status === 'rejected' ? 'rejected' as const : 'failed' as const
            if (item.kind === 'comment' && item.payload.localId) {
              comments = comments.map((comment) => comment.id === item.payload.localId ? { ...comment, syncStatus } : comment)
            } else if (item.kind === 'reply' && item.payload.replyId && item.payload.commentId) {
              comments = comments.map((comment) => comment.id === item.payload.commentId ? {
                ...comment,
                replies: comment.replies.map((reply) => reply.id === item.payload.replyId ? { ...reply, syncStatus } : reply),
              } : comment)
            }
          }

          return { queue, conflicts, comments }
        })
        return summary
      } catch {
        // 网络整体不可用：队列原样保留，已送的不重送，恢复后只补没成功的
        set((state) => ({
          queue: state.queue.map((item) => items.some((queued) => queued.id === item.id)
            ? { ...item, status: 'failed' as const, lastError: '网络连接中断，队列已保留；恢复后仅重试未成功的条目' }
            : item),
        }))
        return { accepted: 0, conflict: 0, rejected: 0, failed: items.length }
      } finally {
        set({ syncing: false })
      }
    },
    retryQueueItem: async (itemId) => {
      set((state) => ({
        queue: state.queue.map((item) => item.id === itemId ? { ...item, status: 'pending' as const, lastError: undefined, rejectReason: undefined } : item),
      }))
      await get().syncQueue()
    },
    rebaseQueueItem: async (itemId) => {
      set((state) => ({
        queue: state.queue.map((item) => item.id === itemId ? { ...item, status: 'pending' as const, lastError: undefined, rejectReason: undefined } : item),
      }))
      await get().syncQueue()
    },
    discardQueueItem: (itemId) => set((state) => {
      const item = state.queue.find((queued) => queued.id === itemId)
      const queue = state.queue.filter((queued) => queued.id !== itemId)
      let comments = state.comments
      if (item?.kind === 'comment' && item.payload.localId) {
        comments = comments.map((comment) => comment.id === item.payload.localId ? { ...comment, syncStatus: undefined } : comment)
      } else if (item?.kind === 'reply' && item.payload.replyId && item.payload.commentId) {
        comments = comments.map((comment) => comment.id === item.payload.commentId ? {
          ...comment,
          replies: comment.replies.map((reply) => reply.id === item.payload.replyId ? { ...reply, syncStatus: undefined } : reply),
        } : comment)
      }
      return { queue, comments }
    }),
    clearSucceeded: () => set((state) => ({ queue: state.queue.filter((item) => item.status !== 'succeeded') })),
    restoreArchive: (archiveId) => {
      const archive = get().archives.find((item) => item.id === archiveId)
      if (!archive) return
      const currentText = get().paragraphs.find((paragraph) => paragraph.id === archive.paragraphId)?.text ?? archive.text
      record((state) => ({
        paragraphs: state.paragraphs.map((paragraph) => paragraph.id === archive.paragraphId
          ? { ...paragraph, text: archive.text, status: 'open' as const, highlighted: true }
          : paragraph),
      }))
      set((state) => ({ archives: state.archives.filter((item) => item.id !== archiveId) }))
      // 恢复落选版本视为一次新的本地改动，重新进入待提交队列
      get().enqueueParagraphEdit(archive.paragraphId, currentText, archive.text)
    },
    undo: () => set((state) => {
      const previous = state.past.at(-1)
      if (!previous) return state
      const current = { paragraphs: clone(state.paragraphs), comments: clone(state.comments), versions: clone(state.versions) }
      persistDraft(previous.paragraphs, previous.comments, previous.versions)
      return { ...previous, past: state.past.slice(0, -1), future: [current, ...state.future], dirty: true }
    }),
    redo: () => set((state) => {
      const next = state.future[0]
      if (!next) return state
      const current = { paragraphs: clone(state.paragraphs), comments: clone(state.comments), versions: clone(state.versions) }
      persistDraft(next.paragraphs, next.comments, next.versions)
      return { ...next, past: [...state.past, current], future: state.future.slice(1), dirty: true }
    }),
    save: () => {
      persistDraft(get().paragraphs, get().comments, get().versions)
      set({ dirty: false })
    },
    resetDemo: () => {
      localStorage.removeItem(DRAFT_KEY)
      localStorage.removeItem(QUEUE_KEY)
      resetMockServer(baseParagraphs)
      set({
        paragraphs: clone(baseParagraphs),
        comments: clone(baseComments),
        versions: clone(initialVersions),
        conflicts: [],
        queue: [],
        archives: [],
        networkOnline: true,
        syncing: false,
        failRandom: false,
        past: [],
        future: [],
        dirty: false,
      })
      persistDraft(baseParagraphs, baseComments, initialVersions)
    },
  }
})

// 队列与存档独立持久化，断网或刷新后不丢失
useReviewStore.subscribe((state) => {
  persistQueue(state.queue, state.archives)
})

// 远端审阅服务以当前示例段落为种子（p-03 锁定、p-04 已合并、p-06 已被他人改过）
resetMockServer(baseParagraphs)
