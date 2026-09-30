import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftOutlined, ArrowRightOutlined, BranchesOutlined, CheckOutlined, CloseOutlined,
  CloudUploadOutlined, CommentOutlined, DeleteOutlined, DiffOutlined, DisconnectOutlined, EditOutlined,
  FileDoneOutlined, FileTextOutlined, HistoryOutlined, InboxOutlined, LockOutlined,
  MenuFoldOutlined, MessageOutlined, PlusOutlined, RedoOutlined, SaveOutlined, SendOutlined,
  SwapOutlined, SyncOutlined, UndoOutlined, UnlockOutlined, UserSwitchOutlined, WifiOutlined,
} from '@ant-design/icons'
import { Alert, Badge, Button, Card, Checkbox, Divider, Drawer, Empty, Input, Modal, Radio, Segmented, Select, Space, Switch, Tag, Tooltip, message } from 'antd'
import { submitRemotePatch } from './services/mockApi'
import { useReviewStore } from './store/review'
import type { Comment, CommentType, Paragraph, QueueItem, QueueItemStatus, Role } from './types'

const roleMeta: Record<Role, { label: string; description: string; color: string }> = {
  author: { label: '作者工作区', description: '编辑正文，逐条接受或拒绝修改建议', color: '#2f6f5e' },
  reviewer: { label: '审稿人工作区', description: '引用原文、添加批注与修改建议并参与讨论', color: '#9a5b25' },
  editor: { label: '编辑工作区', description: '合并重复意见、锁定已确认段落并比较版本', color: '#5b4d8e' },
}
const roleIcon = (role: Role) => role === 'author' ? <FileDoneOutlined /> : role === 'reviewer' ? <CommentOutlined /> : <BranchesOutlined />
const formatDate = (value: number) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

const queueStatusMeta: Record<QueueItemStatus, { label: string; color: string }> = {
  pending: { label: '待提交', color: 'gold' },
  syncing: { label: '同步中', color: 'blue' },
  conflict: { label: '冲突待选版', color: 'volcano' },
  rejected: { label: '已退回', color: 'orange' },
  failed: { label: '失败', color: 'red' },
  succeeded: { label: '已同步', color: 'green' },
}
const rejectReasonLabel = (reason?: 'locked' | 'already-merged') => reason === 'locked' ? '段落已被编辑锁定' : reason === 'already-merged' ? '远端已合并他人意见' : ''

export default function App() {
  const {
    role, paragraphs, comments, versions, selectedParagraphId, commentFilter, revisionMode, dirty, conflicts,
    queue, archives, networkOnline, syncing, failRandom,
    setRole, selectParagraph, setCommentFilter, setRevisionMode, updateParagraph, addComment, replyComment,
    resolveSuggestion, mergeComment, toggleLock, createVersion, addConflict, resolveConflict, dismissConflict, locateConflict,
    setNetworkOnline, setFailRandom, syncQueue, retryQueueItem, rebaseQueueItem, discardQueueItem, clearSucceeded, restoreArchive,
    undo, redo, save, resetDemo,
  } = useReviewStore()
  const [composerOpen, setComposerOpen] = useState(false)
  const [commentType, setCommentType] = useState<CommentType>('comment')
  const [commentBody, setCommentBody] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [quote, setQuote] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [versionOpen, setVersionOpen] = useState(false)
  const [versionA, setVersionA] = useState(versions[1]?.id ?? versions[0]?.id)
  const [versionB, setVersionB] = useState(versions[0]?.id)
  const [versionLabel, setVersionLabel] = useState('')
  const [queueOpen, setQueueOpen] = useState(false)

  const selected = paragraphs.find((paragraph) => paragraph.id === selectedParagraphId) ?? paragraphs[0]
  const sections = useMemo(() => Array.from(new Set(paragraphs.map((paragraph) => paragraph.section))), [paragraphs])
  const paragraphCommentCounts = useMemo(() => comments.reduce<Record<string, number>>((acc, comment) => {
    acc[comment.paragraphId] = (acc[comment.paragraphId] ?? 0) + 1
    return acc
  }, {}), [comments])
  const duplicateParagraphIds = useMemo(() => new Set(Object.entries(paragraphCommentCounts).filter(([, count]) => count > 1).map(([id]) => id)), [paragraphCommentCounts])
  const visibleComments = useMemo(() => comments.filter((comment) => {
    if (commentFilter === 'open') return comment.status === 'open'
    if (commentFilter === 'suggestion') return comment.type === 'suggestion' && comment.status === 'open'
    if (commentFilter === 'duplicate') return duplicateParagraphIds.has(comment.paragraphId) && comment.status === 'open'
    return true
  }).sort((a, b) => b.createdAt - a.createdAt), [commentFilter, comments, duplicateParagraphIds])

  const queueCounts = useMemo(() => ({
    pending: queue.filter((item) => item.status === 'pending').length,
    failed: queue.filter((item) => item.status === 'failed').length,
    rejected: queue.filter((item) => item.status === 'rejected').length,
    conflict: queue.filter((item) => item.status === 'conflict').length,
    succeeded: queue.filter((item) => item.status === 'succeeded').length,
  }), [queue])
  const activeQueueCount = queueCounts.pending + queueCounts.failed + queueCounts.rejected + queueCounts.conflict
  const activeQueueItems = queue.filter((item) => item.status === 'pending' || item.status === 'failed' || item.status === 'rejected')
  const paragraphQueueItem = (paragraphId: string) => queue.find((item) => item.kind === 'paragraph' && item.paragraphId === paragraphId && item.status !== 'succeeded')

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  useEffect(() => {
    const handleOnline = () => setNetworkOnline(true)
    const handleOffline = () => setNetworkOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [setNetworkOnline])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
      const state = useReviewStore.getState()
      const index = state.paragraphs.findIndex((paragraph) => paragraph.id === state.selectedParagraphId)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        event.shiftKey ? state.redo() : state.undo()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); state.redo()
      } else if (event.key.toLowerCase() === 'j') {
        event.preventDefault(); const next = state.paragraphs[Math.min(state.paragraphs.length - 1, index + 1)]; if (next) state.selectParagraph(next.id)
      } else if (event.key.toLowerCase() === 'k') {
        event.preventDefault(); const previous = state.paragraphs[Math.max(0, index - 1)]; if (previous) state.selectParagraph(previous.id)
      } else if (event.key.toLowerCase() === 't') {
        event.preventDefault(); state.setRevisionMode(!state.revisionMode)
      } else if (event.key.toLowerCase() === 'l' && state.role === 'editor') {
        event.preventDefault(); state.toggleLock(state.selectedParagraphId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const scrollToParagraph = (id: string) => {
    selectParagraph(id)
    document.getElementById(`paragraph-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const openComposer = (type: CommentType) => {
    const selectedText = window.getSelection()?.toString().trim()
    setQuote(selectedText && selected?.text.includes(selectedText) ? selectedText : selected?.text.slice(0, 64) ?? '')
    setSuggestion(type === 'suggestion' ? selected?.text ?? '' : '')
    setCommentType(type)
    setComposerOpen(true)
  }
  const submitComment = () => {
    if (!selected || !commentBody.trim()) { message.warning('请填写批注内容'); return }
    addComment({ paragraphId: selected.id, type: commentType, quote, body: commentBody.trim(), suggestion: commentType === 'suggestion' ? suggestion : undefined })
    setCommentBody(''); setSuggestion(''); setQuote(''); setComposerOpen(false)
    message.success(commentType === 'suggestion' ? '修改建议已存入待提交队列' : '段落批注已存入待提交队列')
  }
  const handleMockConflict = async () => {
    if (!selected) return
    const response = await submitRemotePatch(selected)
    addConflict({
      id: `conflict-${Date.now()}`, paragraphId: selected.id, localText: selected.text, remoteText: response.remoteText,
      localAuthor: roleMeta[role].label, remoteAuthor: response.remoteAuthor, detectedAt: Date.now(),
    })
    message.warning('模拟接口返回了同段落的远端修改，请处理冲突')
  }
  const handleCreateVersion = () => {
    if (versionLabel.trim()) createVersion(versionLabel.trim())
    else createVersion('')
    setVersionLabel('')
    message.success('当前版本已保存')
  }
  const handleSync = async () => {
    const summary = await syncQueue()
    if (!summary) return
    const parts: string[] = []
    if (summary.accepted) parts.push(`${summary.accepted} 条已对账`)
    if (summary.conflict) parts.push(`${summary.conflict} 段冲突待选版`)
    if (summary.rejected) parts.push(`${summary.rejected} 条被退回队列`)
    if (summary.failed) parts.push(`${summary.failed} 条失败待重试`)
    if (summary.conflict || summary.rejected || summary.failed) message.warning(parts.join('，'))
    else if (summary.accepted) message.success(parts.join('，'))
    else message.info('没有需要同步的内容')
  }
  const kindLabel = (kind: QueueItem['kind']) => kind === 'paragraph' ? '段落修改' : kind === 'comment' ? '段落批注' : '讨论回复'
  const kindIcon = (kind: QueueItem['kind']) => kind === 'paragraph' ? <EditOutlined /> : kind === 'comment' ? <CommentOutlined /> : <MessageOutlined />
  const queueItemDescription = (item: QueueItem) => {
    if (item.kind === 'paragraph') {
      const paragraph = paragraphs.find((target) => target.id === item.paragraphId)
      return `段落 ${paragraph?.number ?? ''}：${item.payload.localText?.slice(0, 72) ?? ''}`
    }
    if (item.kind === 'comment') return `${item.payload.commentType === 'suggestion' ? '修改建议' : '段落批注'}：${item.payload.body?.slice(0, 72) ?? ''}`
    return `回复：${item.payload.body?.slice(0, 72) ?? ''}`
  }
  const comparedA = versions.find((version) => version.id === versionA)
  const comparedB = versions.find((version) => version.id === versionB)
  const comparedRows = comparedA && comparedB ? comparedA.paragraphs.map((paragraph, index) => ({ a: paragraph, b: comparedB.paragraphs[index] })) : []

  return (
    <div className="review-app">
      <header className="app-header">
        <div className="paper-identity">
          <div className="paper-mark">CR</div>
          <div><h1>学术论文协作审阅台</h1><p>Collaborative Research Review · MS-2026-0417</p></div>
        </div>
        <div className="role-switch">
          <Segmented block value={role} onChange={(value) => setRole(value as Role)} options={(Object.keys(roleMeta) as Role[]).map((item) => ({ label: <span>{roleIcon(item)} {roleMeta[item].label.replace('工作区', '')}</span>, value: item }))} />
        </div>
        <Space className="header-actions">
          <Badge dot={dirty}><Button icon={<SaveOutlined />} onClick={() => { save(); message.success('草稿已保存到浏览器') }}>保存</Button></Badge>
          <Tooltip title="撤销 ⌘Z"><Button icon={<UndoOutlined />} disabled={!useReviewStore.getState().past.length} onClick={undo} /></Tooltip>
          <Tooltip title="重做 ⌘Y"><Button icon={<RedoOutlined />} disabled={!useReviewStore.getState().future.length} onClick={redo} /></Tooltip>
          <Button danger={conflicts.length > 0} icon={<SwapOutlined />} onClick={() => void handleMockConflict()}>模拟冲突</Button>
          <Badge count={activeQueueCount} size="small" offset={[-6, 4]}>
            <Button type={activeQueueCount ? 'primary' : 'default'} ghost={!!activeQueueCount} icon={<CloudUploadOutlined />} onClick={() => setQueueOpen(true)}>待提交队列</Button>
          </Badge>
        </Space>
      </header>

      <div className="role-banner" style={{ '--role-color': roleMeta[role].color } as React.CSSProperties}>
        <span className="role-badge">{roleIcon(role)} {roleMeta[role].label}</span>
        <span>{roleMeta[role].description}</span>
        <span className="paper-state"><FileTextOutlined /> 论文正文 v2.4</span>
        <span className="net-controls">
          <Tag icon={networkOnline ? <WifiOutlined /> : <DisconnectOutlined />} color={networkOnline ? 'green' : 'red'}>
            {networkOnline ? '在线' : '离线 · 断网编辑中'}
          </Tag>
          <Switch size="small" checked={networkOnline} onChange={setNetworkOnline} checkedChildren="在线" unCheckedChildren="离线" />
          <Button size="small" type="primary" ghost icon={<SyncOutlined spin={syncing} />} loading={syncing} onClick={() => void handleSync()} disabled={!networkOnline}>
            同步队列{activeQueueCount ? `（${activeQueueCount}）` : ''}
          </Button>
        </span>
      </div>

      {conflicts.filter((conflict) => !conflict.dismissed).length > 0 && (
        <div className="conflict-stack">
          {conflicts.filter((conflict) => !conflict.dismissed).map((conflict) => (
            <Alert
              key={conflict.id} type="error" showIcon message={`段落冲突：${conflict.localAuthor} 与 ${conflict.remoteAuthor} 同时修改，两版均已保留`}
              description={(
                <div className="conflict-content">
                  <div><b>本页版本</b><p>{conflict.localText}</p></div>
                  <div><b>远端版本</b><p>{conflict.remoteText}</p></div>
                  {conflict.baseText && <p className="conflict-base"><DiffOutlined /> 对账基准：{conflict.baseText}</p>}
                  <Space><Button size="small" type="primary" onClick={() => resolveConflict(conflict.id, 'local')}>保留本页</Button><Button size="small" onClick={() => resolveConflict(conflict.id, 'remote')}>采用远端</Button><Button size="small" type="text" onClick={() => dismissConflict(conflict.id)}>稍后处理</Button></Space>
                </div>
              )}
            />
          ))}
        </div>
      )}

      <main className="workspace">
        <aside className="toc-panel">
          <div className="panel-title"><MenuFoldOutlined /> 侧边目录</div>
          <nav>
            {sections.map((section) => (
              <div key={section} className="toc-section">
                <strong>{section}</strong>
                {paragraphs.filter((paragraph) => paragraph.section === section).map((paragraph) => {
                  const queueItem = paragraphQueueItem(paragraph.id)
                  return (
                    <button key={paragraph.id} className={paragraph.id === selected?.id ? 'active' : ''} onClick={() => scrollToParagraph(paragraph.id)}>
                      <span>{paragraph.number}</span>
                      <span>{paragraph.text.slice(0, 24)}…</span>
                      {paragraph.status === 'locked' && <LockOutlined />}
                      {queueItem && <Tag color={queueStatusMeta[queueItem.status].color} className="toc-queue-tag">{queueStatusMeta[queueItem.status].label}</Tag>}
                      {!!paragraphCommentCounts[paragraph.id] && <Badge count={paragraphCommentCounts[paragraph.id]} size="small" />}
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>
          <div className="version-box">
            <div className="panel-title"><HistoryOutlined /> 版本</div>
            <Input value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} placeholder="新版本名称" onPressEnter={handleCreateVersion} />
            <Button block icon={<PlusOutlined />} onClick={handleCreateVersion}>保存当前版本</Button>
            <Button block icon={<DiffOutlined />} onClick={() => setVersionOpen(true)}>比较两个版本</Button>
          </div>
        </aside>

        <section className="document-panel">
          <div className="document-toolbar">
            <div><h2>大语言模型辅助下的开源维护协作研究</h2><p>作者：林晓、陈默、王远 · 最近保存 {formatDate(Date.now())}</p></div>
            <Space>
              <Checkbox checked={revisionMode} onChange={(event) => setRevisionMode(event.target.checked)}>修订模式</Checkbox>
              <Tag color={dirty ? 'gold' : 'green'}>{dirty ? '有未保存修改' : '已保存'}</Tag>
            </Space>
          </div>

          <div className="paper-sheet">
            <div className="paper-kicker">RESEARCH ARTICLE · CONFIDENTIAL REVIEW</div>
            {sections.map((section) => (
              <section key={section} className="paper-section">
                <h3>{section}</h3>
                {paragraphs.filter((paragraph) => paragraph.section === section).map((paragraph) => {
                  const queueItem = paragraphQueueItem(paragraph.id)
                  return (
                    <article
                      id={`paragraph-${paragraph.id}`} key={paragraph.id} onMouseUp={() => setQuote(window.getSelection()?.toString().trim() ?? '')}
                      className={`paragraph-card ${paragraph.id === selected?.id ? 'selected' : ''} ${paragraph.highlighted ? 'highlighted' : ''} ${paragraph.status === 'locked' ? 'locked' : ''}`}
                      onClick={() => selectParagraph(paragraph.id)}
                    >
                      <div className="paragraph-meta">
                        <span className="paragraph-no">{paragraph.number}</span>
                        <span>段落 {paragraph.number.replace('.', '')}</span>
                        {paragraph.status === 'locked' && <Tag icon={<LockOutlined />} color="purple">已锁定</Tag>}
                        {paragraph.status === 'accepted' && <Tag icon={<CheckOutlined />} color="green">已确认</Tag>}
                        {queueItem && <Tag color={queueStatusMeta[queueItem.status].color}>{queueStatusMeta[queueItem.status].label}</Tag>}
                        {!!paragraphCommentCounts[paragraph.id] && <Tag icon={<MessageOutlined />}>{paragraphCommentCounts[paragraph.id]} 条意见</Tag>}
                      </div>
                      {revisionMode ? (
                        <div className="revision-grid">
                          <div><small>原稿</small><p>{paragraph.original}</p></div>
                          <div><small>当前修订</small><p>{paragraph.text}</p></div>
                        </div>
                      ) : role === 'author' ? (
                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} value={paragraph.text} readOnly={paragraph.status === 'locked'} onChange={(event) => updateParagraph(paragraph.id, event.target.value)} />
                      ) : (
                        <p className="paragraph-text">{paragraph.text}</p>
                      )}
                      <div className="paragraph-actions">
                        {role === 'reviewer' && <><Button size="small" icon={<CommentOutlined />} onClick={(event) => { event.stopPropagation(); selectParagraph(paragraph.id); openComposer('comment') }}>添加批注</Button><Button size="small" icon={<FileDoneOutlined />} onClick={(event) => { event.stopPropagation(); selectParagraph(paragraph.id); openComposer('suggestion') }}>提出建议</Button></>}
                        {role === 'editor' && <Button size="small" icon={paragraph.status === 'locked' ? <UnlockOutlined /> : <LockOutlined />} onClick={(event) => { event.stopPropagation(); toggleLock(paragraph.id) }}>{paragraph.status === 'locked' ? '解除锁定' : '锁定段落'}</Button>}
                        {role === 'author' && <span className="author-tip">可直接修改正文，改动先入本地队列，联网后逐段对账</span>}
                      </div>
                    </article>
                  )
                })}
              </section>
            ))}
          </div>
        </section>

        <aside className="comments-panel">
          <div className="comments-header">
            <div><h2><CommentOutlined /> 审阅意见 <Badge count={comments.filter((comment) => comment.status === 'open').length} /></h2><p>引用原文、讨论与修订建议</p></div>
          </div>
          <div className="comment-filters">
            <Radio.Group value={commentFilter} onChange={(event) => setCommentFilter(event.target.value)} buttonStyle="solid" size="small">
              <Radio.Button value="all">全部</Radio.Button><Radio.Button value="open">待处理</Radio.Button><Radio.Button value="suggestion">建议</Radio.Button><Radio.Button value="duplicate">重复</Radio.Button>
            </Radio.Group>
          </div>
          <div className="comment-list">
            {visibleComments.map((comment) => {
              const paragraph = paragraphs.find((item) => item.id === comment.paragraphId)
              return (
                <Card key={comment.id} size="small" className={`comment-card ${comment.status}`} title={<span>{comment.author} <Tag>{comment.type === 'suggestion' ? '修改建议' : '段落批注'}</Tag></span>} extra={<small>{formatDate(comment.createdAt)}</small>}>
                  <button className="quote-line" onClick={() => paragraph && scrollToParagraph(paragraph.id)}>“{comment.quote}” · 段落 {paragraph?.number}</button>
                  <p className="comment-body">{comment.body}</p>
                  {comment.suggestion && <div className="suggestion-box"><small>建议改为</small><p>{comment.suggestion}</p></div>}
                  {comment.status !== 'open' && <Tag color={comment.status === 'accepted' ? 'green' : comment.status === 'rejected' ? 'red' : 'blue'}>{comment.status === 'accepted' ? '已接受' : comment.status === 'rejected' ? '已拒绝' : '已合并'}</Tag>}
                  {comment.syncStatus === 'pending' && <Tag color="gold">待同步</Tag>}
                  {comment.syncStatus === 'failed' && <Tag color="red">同步失败</Tag>}
                  {comment.syncStatus === 'rejected' && <Tag color="orange">已退回</Tag>}
                  <div className="replies">
                    {comment.replies.map((reply) => <div key={reply.id} className="reply"><b>{reply.author}</b><span>{reply.body}</span>
                      {reply.syncStatus === 'pending' && <Tag color="gold">待同步</Tag>}
                      {reply.syncStatus === 'failed' && <Tag color="red">同步失败</Tag>}
                      {reply.syncStatus === 'rejected' && <Tag color="orange">已退回</Tag>}
                    </div>)}
                  </div>
                  <div className="reply-box">
                    <Input size="small" value={replyDrafts[comment.id] ?? ''} onChange={(event) => setReplyDrafts((drafts) => ({ ...drafts, [comment.id]: event.target.value }))} placeholder="回复讨论…" onPressEnter={() => { const body = replyDrafts[comment.id]?.trim(); if (body) { replyComment(comment.id, body); setReplyDrafts((drafts) => ({ ...drafts, [comment.id]: '' })) } }} />
                    <Button size="small" type="text" icon={<SendOutlined />} onClick={() => { const body = replyDrafts[comment.id]?.trim(); if (body) { replyComment(comment.id, body); setReplyDrafts((drafts) => ({ ...drafts, [comment.id]: '' })) } }} />
                  </div>
                  {comment.status === 'open' && role === 'author' && comment.type === 'suggestion' && <div className="decision-row"><Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => resolveSuggestion(comment.id, true)}>接受修改</Button><Button danger size="small" icon={<CloseOutlined />} onClick={() => resolveSuggestion(comment.id, false)}>拒绝</Button></div>}
                  {comment.status === 'open' && role === 'editor' && duplicateParagraphIds.has(comment.paragraphId) && (() => {
                    const sibling = comments.find((item) => item.id !== comment.id && item.paragraphId === comment.paragraphId && item.status === 'open')
                    return sibling ? <Button size="small" type="dashed" icon={<BranchesOutlined />} onClick={() => mergeComment(comment.id, sibling.id)}>合并到“{sibling.author}”意见</Button> : null
                  })()}
                </Card>
              )
            })}
            {!visibleComments.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选下没有意见" />}
          </div>
          <div className="keyboard-hint"><span><kbd>J</kbd>/<kbd>K</kbd> 段落导航</span><span><kbd>T</kbd> 修订模式</span>{role === 'editor' && <span><kbd>L</kbd> 锁定</span>}<span><kbd>⌘Z</kbd> 撤销</span></div>
        </aside>
      </main>

      <Modal title={commentType === 'suggestion' ? '提出修改建议' : '添加段落批注'} open={composerOpen} onCancel={() => setComposerOpen(false)} onOk={submitComment} okText="存入队列" width={620}>
        <div className="composer">
          <label>引用原文</label>
          <Input.TextArea value={quote} onChange={(event) => setQuote(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} />
          <label>{commentType === 'suggestion' ? '建议改为' : '批注内容'}</label>
          {commentType === 'suggestion' && <Input.TextArea value={suggestion} onChange={(event) => setSuggestion(event.target.value)} autoSize={{ minRows: 3, maxRows: 7 }} />}
          <label>说明</label>
          <Input.TextArea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="说明修改理由或希望作者关注的问题" autoSize={{ minRows: 2, maxRows: 5 }} />
        </div>
      </Modal>

      <Modal title="版本比较" open={versionOpen} onCancel={() => setVersionOpen(false)} footer={null} width={980}>
        <div className="compare-selectors">
          <Select value={versionA} onChange={setVersionA} options={versions.map((version) => ({ label: `${version.label} · ${formatDate(version.createdAt)}`, value: version.id }))} />
          <ArrowRightOutlined />
          <Select value={versionB} onChange={setVersionB} options={versions.map((version) => ({ label: `${version.label} · ${formatDate(version.createdAt)}`, value: version.id }))} />
        </div>
        <div className="version-table">
          <div className="version-head"><b>{comparedA?.label ?? '版本 A'}</b><b>{comparedB?.label ?? '版本 B'}</b></div>
          {comparedRows.map(({ a, b }) => (
            <div key={a.id} className={`version-row ${a.text !== b?.text ? 'changed' : ''}`}>
              <div><span>{a.number}</span>{a.text}</div><div><span>{b?.number ?? '—'}</span>{b?.text ?? '段落已删除'}</div>
            </div>
          ))}
        </div>
      </Modal>

      <Drawer
        title={<span><CloudUploadOutlined /> 本地待提交队列</span>}
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        width={600}
        extra={<Button size="small" type="primary" ghost icon={<SyncOutlined spin={syncing} />} loading={syncing} onClick={() => void handleSync()} disabled={!networkOnline || activeQueueCount === 0}>立即同步</Button>}
      >
        <div className="queue-summary">
          <Tag color="gold">待提交 {queueCounts.pending}</Tag>
          <Tag color="red">失败 {queueCounts.failed}</Tag>
          <Tag color="orange">已退回 {queueCounts.rejected}</Tag>
          <Tag color="volcano">冲突 {queueCounts.conflict}</Tag>
          <Tag color="green">已同步 {queueCounts.succeeded}</Tag>
          <Checkbox checked={failRandom} onChange={(event) => setFailRandom(event.target.checked)}>模拟服务端随机失败</Checkbox>
        </div>
        {!networkOnline && <Alert className="queue-offline" type="warning" showIcon message="当前离线：段落、批注与回复先保存在本页，网络恢复后自动与审阅服务逐段对账，不会互相覆盖。" />}

        {queueCounts.conflict > 0 && (
          <div className="queue-section">
            <div className="panel-title"><SwapOutlined /> 段落冲突（{queueCounts.conflict}）</div>
            {queue.filter((item) => item.status === 'conflict').map((item) => {
              const conflict = conflicts.find((target) => target.clientItemId === item.id)
              return (
                <div key={item.id} className="queue-item conflict">
                  <div className="queue-item-head">{kindIcon(item.kind)}<b>段落修改冲突</b><Tag color="volcano">待选版</Tag><small>{formatDate(item.createdAt)}</small></div>
                  <p className="queue-item-body">本页与远端都修改了段落 {paragraphs.find((target) => target.id === item.paragraphId)?.number}，两版均已保留，请在顶部冲突卡片中选择采用哪一版；落选版本可在下方存档中找回。</p>
                  <div className="queue-item-actions">
                    <Button size="small" type="primary" onClick={() => { if (conflict) locateConflict(conflict.id); setQueueOpen(false) }}>去处理冲突</Button>
                    <Button size="small" type="text" danger onClick={() => discardQueueItem(item.id)}>放弃本页修改</Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="queue-section">
          <div className="panel-title"><InboxOutlined /> 待处理（{activeQueueItems.length}）</div>
          {activeQueueItems.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有待提交的内容" />}
          {activeQueueItems.map((item) => {
            const meta = queueStatusMeta[item.status]
            return (
              <div key={item.id} className={`queue-item ${item.status}`}>
                <div className="queue-item-head">
                  {kindIcon(item.kind)}<b>{kindLabel(item.kind)}</b>
                  <Tag color={meta.color}>{meta.label}</Tag>
                  {item.rejectReason && <Tag color="orange">{rejectReasonLabel(item.rejectReason)}</Tag>}
                  <small>{formatDate(item.createdAt)}{item.attempts > 0 ? ` · 已重试 ${item.attempts} 次` : ''}</small>
                </div>
                <p className="queue-item-body">{queueItemDescription(item)}</p>
                {item.lastError && <p className="queue-item-error">{item.lastError}</p>}
                <div className="queue-item-actions">
                  {item.status === 'failed' && <Button size="small" type="primary" ghost onClick={() => void retryQueueItem(item.id)}>重试</Button>}
                  {item.status === 'pending' && <Button size="small" type="primary" ghost loading={syncing} onClick={() => void retryQueueItem(item.id)}>立即提交</Button>}
                  {item.status === 'rejected' && <Button size="small" type="primary" ghost onClick={() => void rebaseQueueItem(item.id)}>重新提交</Button>}
                  <Button size="small" type="text" danger onClick={() => discardQueueItem(item.id)}>放弃</Button>
                </div>
              </div>
            )
          })}
        </div>

        {queueCounts.succeeded > 0 && (
          <div className="queue-section">
            <div className="panel-title"><CheckOutlined /> 已同步（{queueCounts.succeeded}）<Button size="small" type="link" onClick={clearSucceeded}>清除记录</Button></div>
            {queue.filter((item) => item.status === 'succeeded').map((item) => (
              <div key={item.id} className="queue-item succeeded">
                <div className="queue-item-head">{kindIcon(item.kind)}<b>{kindLabel(item.kind)}</b><Tag color="green">已对账</Tag><small>{formatDate(item.createdAt)}</small></div>
                <p className="queue-item-body">{queueItemDescription(item)}</p>
              </div>
            ))}
          </div>
        )}

        <div className="queue-section archive-section">
          <div className="panel-title"><HistoryOutlined /> 落选版本存档（{archives.length}）</div>
          <p className="archive-hint">冲突中未被采用的版本不会丢失，可随时找回；恢复后会作为一次新的本地修改重新排队对账。</p>
          {archives.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无落选版本" />}
          {archives.map((archive) => (
            <div key={archive.id} className="archive-item">
              <div className="queue-item-head">
                <b>段落 {paragraphs.find((target) => target.id === archive.paragraphId)?.number ?? '—'}</b>
                <Tag color={archive.source === 'local' ? 'blue' : 'purple'}>{archive.source === 'local' ? '本页版本' : '远端版本'}</Tag>
                <small>{formatDate(archive.archivedAt)}</small>
              </div>
              <p className="queue-item-body">{archive.text}</p>
              <Button size="small" icon={<UndoOutlined />} onClick={() => restoreArchive(archive.id)}>恢复此版本</Button>
            </div>
          ))}
        </div>
      </Drawer>

      <footer className="app-footer">
        <span>本地草稿与待提交队列自动持久化 · 断网可继续编辑，恢复后逐段对账，失败只补未成功的段落</span>
        <Button type="text" size="small" icon={<DeleteOutlined />} onClick={() => { resetDemo(); message.success('已重置示例数据') }}>重置示例</Button>
      </footer>
    </div>
  )
}
