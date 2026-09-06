import { useEffect, useState } from 'react';

export type CodexQuestionRequest = {
  providerId?: 'codex' | 'claude';
  detail?: string;
  runId: string;
  requestId: string | number;
  threadId: string;
  questions: Array<{
    id: string;
    header: string;
    question: string;
    isSecret?: boolean;
    multiSelect?: boolean;
    allowCustom?: boolean;
    options?: Array<{ label: string; description: string }> | null;
  }>;
};

const QuestionCard = ({ request, refresh }: { request: CodexQuestionRequest; refresh: () => void }) => {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const answerFor = (id: string) => [...(answers[id] ?? []), ...(customAnswers[id]?.trim() ? [customAnswers[id]] : [])];
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const complete = request.questions.every((question) => answerFor(question.id).length > 0);

  const submit = async () => {
    if (sending || !complete) return;
    setSending(true);
    setError('');
    try {
      const send = request.providerId === 'claude' ? window.orion?.answerClaudeQuestions : window.orion?.answerCodexQuestions;
      const accepted = await send?.(
        request.runId,
        request.requestId,
        Object.fromEntries(request.questions.map((question) => [question.id, answerFor(question.id)]))
      );
      if (!accepted) setError('This question is no longer waiting for an answer.');
      refresh();
    } catch {
      setError('Could not send your answers. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="codex-question-card">
      {request.detail && <pre className="agent-request-detail">{request.detail}</pre>}
      {request.questions.map((question) => (
        <div key={question.id} className="codex-question">
          <strong>{question.header}</strong>
          <label htmlFor={`codex-question-${request.requestId}-${question.id}`}>{question.question}</label>
          {!!question.options?.length && !question.isSecret && (
            <div className="codex-question-options" role="group" aria-label={question.header}>
              {question.options.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={answers[question.id]?.includes(option.label) ?? false}
                  disabled={sending}
                  onClick={() => {
                    if (!question.multiSelect) setCustomAnswers((current) => ({ ...current, [question.id]: '' }));
                    setAnswers((current) => ({ ...current, [question.id]: question.multiSelect
                      ? (current[question.id]?.includes(option.label)
                        ? current[question.id].filter((value) => value !== option.label)
                        : [...(current[question.id] ?? []), option.label])
                      : [option.label] }));
                  }}
                >
                  <span>{option.label}</span>
                  <small>{option.description}</small>
                </button>
              ))}
            </div>
          )}
          {question.allowCustom !== false && <input
            id={`codex-question-${request.requestId}-${question.id}`}
            type={question.isSecret ? 'password' : 'text'}
            autoComplete="off"
            placeholder="Your answer…"
            value={customAnswers[question.id] ?? ''}
            disabled={sending}
            onChange={(event) => {
              if (!question.multiSelect) setAnswers((current) => ({ ...current, [question.id]: [] }));
              setCustomAnswers((current) => ({ ...current, [question.id]: event.target.value }));
            }}
          />}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      <button type="button" className="codex-question-submit" disabled={sending || !complete} onClick={() => void submit()}>
        {sending ? 'Sending…' : 'Send answers'}
      </button>
    </div>
  );
};

export const CodexQuestions = ({ threadId }: { threadId: string }) => {
  const [requests, setRequests] = useState<CodexQuestionRequest[]>([]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    const refresh = async () => {
      const current = ++generation;
      try {
        const [codex, claude] = await Promise.all([
          window.orion?.getCodexQuestions?.(threadId),
          window.orion?.getClaudeQuestions?.(threadId),
        ]);
        const pending = [...(codex ?? []), ...(claude ?? [])];
        if (!disposed && current === generation) setRequests(pending ?? []);
      } catch {
        // Keep existing answers available during a transient IPC failure.
      }
    };
    const unsubscribe = window.orion?.onAgentTurnEvent?.((event) => {
      if (event.threadId === threadId && ['user-input', 'done', 'error'].includes(event.type)) void refresh();
    });
    void refresh();
    return () => { disposed = true; unsubscribe?.(); };
  }, [threadId, revision]);
  const visible = requests.filter((request) => request.threadId === threadId);
  if (!visible.length) return null;
  return (
    <div className="codex-questions" aria-label="Agent questions and approvals">
      {visible.map((request) => (
        <QuestionCard key={`${request.runId}:${request.requestId}`} request={request} refresh={() => setRevision((value) => value + 1)} />
      ))}
    </div>
  );
};
