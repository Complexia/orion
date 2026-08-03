type DriverModel = {
  id: string;
  providerId: string;
};

export const resolveOrionMainDriverModel = <Model extends DriverModel>(
  models: Model[],
  mainDriverModelId: string | null | undefined,
  defaultModelId: string,
  terminalModelId: string
) => {
  const configured = models.find((model) => model.id === mainDriverModelId);
  if (configured && configured.providerId !== 'orion' && configured.id !== terminalModelId) {
    return configured;
  }
  return (
    models.find((model) => model.id === defaultModelId) ??
    models.find((model) => model.providerId !== 'orion' && model.id !== terminalModelId)
  );
};
