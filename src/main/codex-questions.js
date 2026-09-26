export const validQuestionAnswers = (questions, answers) =>
  answers && typeof answers === 'object' && questions.every((question) => {
    const values = answers[question.id];
    return Array.isArray(values) && values.length > 0 &&
      values.every((value) => typeof value === 'string' && value.trim());
  });

// Keep only question data after a run ends, never its driver or transport.
export const createCompletedCodexQuestions = () => {
  const runs = new Map();
  const sending = new Set();
  return {
    retain(runId, requests) {
      const pending = requests.filter((request) => request.async);
      if (pending.length) runs.set(runId, pending.map((request) => ({ ...request, runId })));
    },
    list(threadId) {
      return [...runs.values()].flat().filter((request) => threadId === undefined || request.threadId === threadId);
    },
    answer(runId, requestId, answers) {
      const requests = runs.get(runId);
      const request = requests?.find((entry) => entry.requestId === requestId);
      if (!request || !validQuestionAnswers(request.questions, answers)) return null;
      const remaining = requests.filter((entry) => entry !== request);
      if (remaining.length) runs.set(runId, remaining);
      else runs.delete(runId);
      return request;
    },
    async deliver(runId, requestId, answers, text, driver) {
      const key = JSON.stringify([runId, requestId]);
      if (sending.has(key)) return false;
      sending.add(key);
      try {
        // true asks the renderer to send a follow-up; 'delivered' records an
        // accepted native reply without sending it a second time.
        if (this.answer(runId, requestId, answers)) return true;
        if (await driver?.answerAsyncUserInput?.(requestId, answers, text)) {
          this.answer(runId, requestId, answers);
          return 'delivered';
        }
        // Completion may have transferred the question during the RPC.
        return Boolean(this.answer(runId, requestId, answers));
      } finally {
        sending.delete(key);
      }
    },
    clear() { runs.clear(); },
  };
};
