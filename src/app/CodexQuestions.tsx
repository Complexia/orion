import { useEffect, useState } from 'react';

export type CodexQuestionRequest = {
  runId: string;
  requestId: string | number;
  threadId: string;
  questions: Array<{
    id: string;
    header: string;
    question: string;
    isSecret?: boolean;
    options?: Array<{ label: string; description: string }> | null;
  }>;
};

const QuestionCard = ({ request, refresh }: { request: CodexQuestionRequest; refresh: () => void }) => {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const complete = request.questions.every((question) => answers[question.id]?.trim());

  const submit = async () => {
    if (sending || !complete) return;
    setSending(true);
    setError('');
    try {
      const accepted = await window.orion?.answerCodexQuestions?.(
        request.runId,
        request.requestId,
        Object.fromEntries(request.questions.map((question) => [question.id, [answers[question.id]]]))
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
                  aria-pressed={answers[question.id] === option.label}
                  disabled={sending}
                  onClick={() => setAnswers((current) => ({ ...current, [question.id]: option.label }))}
                >
                  <span>{option.label}</span>
                  <small>{option.description}</small>
                </button>
              ))}
            </div>
          )}
          <input
            id={`codex-question-${request.requestId}-${question.id}`}
            type={question.isSecret ? 'password' : 'text'}
            autoComplete="off"
            placeholder="Your answer…"
            value={answers[question.id] ?? ''}
            disabled={sending}
            onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
          />
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
        const pending = await window.orion?.getCodexQuestions?.(threadId);
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
    <div className="codex-questions" aria-label="Questions from Codex">
      {visible.map((request) => (
        <QuestionCard key={`${request.runId}:${request.requestId}`} request={request} refresh={() => setRevision((value) => value + 1)} />
      ))}
    </div>
  );
};
