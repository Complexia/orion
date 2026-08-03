import React from 'react';
import { Cast, KeyRound, Link2, Plus, RefreshCw, Trash2, Unplug } from 'lucide-react';
import type { RemoteControlSettings as RemoteControlSettingsValue } from '../store';
import type { RemoteControlState } from '../types';
import type { OrionAccountState } from './appTypes';
import {
  canGenerateRemotePairingCode,
  parseRemotePortDraft,
  remoteControlIsAuthenticated,
} from './remote-control-policy';

// The engine (server, pairing, sessions) lives in main; this panel mirrors its
// state over remote:state and only mounts while the tab is open, so it owns
// its own subscription instead of routing through App (same reasoning as
// SkillsSettings).
export type RemoteControlSettingsProps = {
  remoteControlSettings: RemoteControlSettingsValue;
  setRemoteControlSettings: (updates: Partial<RemoteControlSettingsValue>) => void;
  accountState: OrionAccountState;
  formatCheckedTime: (iso: string) => string;
};

const RemoteControlSettings = React.memo(function RemoteControlSettings({
  remoteControlSettings,
  setRemoteControlSettings,
  accountState,
  formatCheckedTime,
}: RemoteControlSettingsProps) {
  const [remoteState, setRemoteState] = React.useState<RemoteControlState | null>(null);
  const [pairHost, setPairHost] = React.useState('');
  const [pairPort, setPairPort] = React.useState(String(remoteControlSettings.port));
  const [portDraft, setPortDraft] = React.useState(String(remoteControlSettings.port));
  const [pairMachineId, setPairMachineId] = React.useState('');
  const [pairCode, setPairCode] = React.useState('');
  const [pairing, setPairing] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    void window.orion?.remoteControlGetState?.().then((state) => {
      if (mountedRef.current) setRemoteState(state);
    });
    const unsubscribe = window.orion?.onRemoteState?.((state) => {
      if (mountedRef.current) setRemoteState(state);
    });
    return () => unsubscribe?.();
  }, []);

  React.useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  React.useEffect(() => {
    setPortDraft(String(remoteControlSettings.port));
  }, [remoteControlSettings.port]);

  const authenticated = remoteControlIsAuthenticated(
    accountState.authenticated,
    remoteState?.authenticated
  );
  // The engine reports available:false when it could not read or persist
  // pairings at all — pairing forms would only produce failures, so hide them.
  const engineReady = remoteState?.available !== false;
  const settings = remoteControlSettings;
  const host = remoteState?.host;
  const machines = remoteState?.machines ?? [];
  const activePairing = host?.pairing ?? null;
  const overInternet = settings.connectionMode === 'relay';
  const relay = host?.relay;
  const canGeneratePairingCode = canGenerateRemotePairingCode({
    connectionMode: settings.connectionMode,
    hostListening: Boolean(host?.listening),
    relayOnline: Boolean(relay?.online),
  });

  const commitPortDraft = () => {
    const port = parseRemotePortDraft(portDraft);
    if (port === null) {
      setPortDraft(String(settings.port));
      return;
    }
    setPortDraft(String(port));
    if (port !== settings.port) setRemoteControlSettings({ port });
  };

  const handleStartPairing = async () => {
    setError(null);
    const result = await window.orion?.remoteStartPairing?.();
    if (!result?.ok) setError(result?.error ?? 'Could not create a pairing code.');
  };

  const handlePair = async () => {
    setError(null);
    setPairing(true);
    try {
      const result = await window.orion?.remotePair?.(
        overInternet
          ? { machineId: pairMachineId.trim(), code: pairCode }
          : { host: pairHost.trim(), port: Number(pairPort), code: pairCode }
      );
      if (!mountedRef.current) return;
      if (result?.ok) {
        setNotice(
          `Paired with ${result.machine?.name ?? (overInternet ? pairMachineId.trim() : pairHost.trim())}. It now appears under Machines in the sidebar.`
        );
        setPairHost('');
        setPairMachineId('');
        setPairCode('');
      } else {
        setError(result?.error ?? 'Pairing failed.');
      }
    } finally {
      if (mountedRef.current) setPairing(false);
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    setBusyId(deviceId);
    try {
      const result = await window.orion?.remoteRevokeDevice?.({ deviceId });
      if (!result?.ok && mountedRef.current) setError(result?.error ?? 'Could not revoke this device.');
    } finally {
      if (mountedRef.current) setBusyId(null);
    }
  };

  const handleRemoveMachine = async (machineId: string) => {
    setBusyId(machineId);
    try {
      const result = await window.orion?.remoteRemoveMachine?.({ machineId });
      if (!result?.ok && mountedRef.current) setError(result?.error ?? 'Could not remove this machine.');
    } finally {
      if (mountedRef.current) setBusyId(null);
    }
  };

  const handleConnectMachine = async (machineId: string) => {
    setBusyId(machineId);
    setError(null);
    try {
      const result = await window.orion?.remoteConnectMachine?.({ machineId });
      if (!result?.ok && mountedRef.current) setError(result?.error ?? 'Could not connect.');
    } finally {
      if (mountedRef.current) setBusyId(null);
    }
  };

  return (
    <>
      <div className="settings-group-label">Remote control</div>
      <div className="settings-group">
        <div className="setting-row">
          <div className="setting-label">
            <div className="setting-label-title">Enable remote control</div>
            <div className="setting-label-desc">
              Off by default. When enabled, a Machines section appears in the sidebar and this
              machine can view and drive the Orion instances it is paired with. Pairing is
              end-to-end encrypted and both machines must be signed in to the same Orion account.
              {!authenticated && !settings.enabled && ' Sign in on the Account tab to enable.'}
            </div>
          </div>
          <label
            className="provider-toggle"
            title={
              authenticated || settings.enabled
                ? 'Enable remote control between your machines'
                : 'Sign in to your Orion account first'
            }
          >
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={!authenticated && !settings.enabled}
              onChange={(e) => setRemoteControlSettings({ enabled: e.target.checked })}
            />
            <span />
          </label>
        </div>

        <div className="setting-row">
          <div className="setting-label">
            <div className="setting-label-title">Allow this machine to be controlled</div>
            <div className="setting-label-desc">
              Listens for connections from your paired machines so they can drive this Orion
              instance. Only devices paired with a code generated here — under your own account —
              can connect. Turn it off to instantly drop every remote session.
            </div>
          </div>
          <label className="provider-toggle" title="Let paired machines control this Orion instance">
            <input
              type="checkbox"
              checked={settings.allowIncoming}
              disabled={!settings.enabled || !authenticated}
              onChange={(e) => setRemoteControlSettings({ allowIncoming: e.target.checked })}
            />
            <span />
          </label>
        </div>

        <div className="setting-row">
          <div className="setting-label">
            <div className="setting-label-title">Reach this machine over the internet</div>
            <div className="setting-label-desc">
              Off: remote-control traffic stays on your own network — the same Wi-Fi, or a VPN like
              Tailscale — and does not use Orion Cloud&apos;s relay. Pairing still contacts Orion Cloud
              briefly to verify that both machines use the same Orion account.
              <br />
              On: Orion Cloud brokers the connection, so your machines can reach each other from
              anywhere without opening a port. It only passes the encrypted bytes along — it cannot
              read what you send, and it cannot control either machine.
              {overInternet && relay?.enabled && (
                <>
                  {' '}
                  {relay.online
                    ? 'This machine is online at Orion Cloud and can be reached by its machine ID.'
                    : `This machine is not reachable over the internet right now${relay.error ? `: ${relay.error}` : '.'}`}
                </>
              )}
            </div>
            {overInternet && remoteState?.machineId && (
              <div className="setting-label-desc">
                Machine ID: <code>{remoteState.machineId}</code>
              </div>
            )}
          </div>
          <label
            className="provider-toggle"
            title={
              overInternet
                ? 'Stop using Orion Cloud and go back to your own network only'
                : 'Let your machines reach each other from anywhere, brokered by Orion Cloud'
            }
          >
            <input
              type="checkbox"
              checked={overInternet}
              disabled={!settings.enabled}
              onChange={(e) =>
                setRemoteControlSettings({ connectionMode: e.target.checked ? 'relay' : 'direct' })
              }
            />
            <span />
          </label>
        </div>

        <div className="setting-row">
          <div className="setting-label">
            <div className="setting-label-title">Port</div>
            <div className="setting-label-desc">
              {host?.listening
                ? `Listening on port ${host.port}${host.addresses.length > 0 ? ` (${host.addresses.join(', ')})` : ''}.`
                : host?.error
                  ? `Not listening: ${host.error}`
                  : 'TCP port other machines connect to while incoming control is on.'}
              {overInternet && ' Machines on your own network keep using this port; the internet route needs no port at all.'}
            </div>
          </div>
          <input
            type="number"
            className="remote-port-input"
            min={1024}
            max={65535}
            value={portDraft}
            disabled={!settings.enabled}
            onChange={(e) => setPortDraft(e.target.value)}
            onBlur={commitPortDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setPortDraft(String(settings.port));
                e.currentTarget.blur();
              }
            }}
          />
        </div>
      </div>

      {remoteState?.error && <div className="skills-message error">{remoteState.error}</div>}
      {(error || notice) && <div className={`skills-message${error ? ' error' : ''}`}>{error || notice}</div>}

      {engineReady && settings.enabled && settings.allowIncoming && (
        <>
          <div className="settings-group-label">Pair a new device</div>
          <div className="settings-group">
            <div className="setting-row">
              <div className="setting-label">
                <div className="setting-label-title">Pairing code</div>
                <div className="setting-label-desc">
                  {activePairing ? (
                    overInternet ? (
                      <>
                        Enter this single-use code on the other machine within 10 minutes, together
                        with this machine’s ID {remoteState?.machineId ? <code>{remoteState.machineId}</code> : null}.
                        Expires {formatCheckedTime(activePairing.expiresAt)}.
                      </>
                    ) : (
                      <>
                        Enter this single-use code on the other machine within 10 minutes, together
                        with this machine’s address
                        {host && host.addresses.length > 0 ? ` (${host.addresses.join(' or ')})` : ''} and
                        port {host?.port}. Expires {formatCheckedTime(activePairing.expiresAt)}.
                      </>
                    )
                  ) : (
                    'Generate a single-use code, then enter it on the machine that should control this one.'
                  )}
                </div>
                {activePairing && <div className="remote-pairing-code">{activePairing.code}</div>}
              </div>
              {activePairing ? (
                <button type="button" className="btn secondary small" onClick={() => void window.orion?.remoteCancelPairing?.()}>
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  className="btn small"
                  disabled={!canGeneratePairingCode}
                  title={canGeneratePairingCode ? 'Generate a pairing code' : 'No incoming route is available'}
                  onClick={() => void handleStartPairing()}
                >
                  <KeyRound size={13} />
                  Generate code
                </button>
              )}
            </div>
          </div>

          <div className="settings-group-label">Devices allowed to control this machine</div>
          <div className="settings-group">
            {(host?.devices.length ?? 0) === 0 && (
              <div className="setting-row">
                <div className="setting-label">
                  <div className="setting-label-desc">No paired devices yet. Generate a pairing code above.</div>
                </div>
              </div>
            )}
            {host?.devices.map((device) => (
              <div key={device.id} className="setting-row">
                <div className="setting-label">
                  <div className="setting-label-title">
                    {device.name}
                    {device.connected && <span className="remote-status-chip connected">Connected</span>}
                  </div>
                  <div className="setting-label-desc">
                    {device.pairedAt ? `Paired ${formatCheckedTime(device.pairedAt)}.` : ''}
                    {device.lastSeenAt ? ` Last seen ${formatCheckedTime(device.lastSeenAt)}.` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="archived-epic-action danger"
                  title="Revoke this device — it can no longer control this machine"
                  disabled={busyId === device.id}
                  onClick={() => void handleRevokeDevice(device.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {engineReady && settings.enabled && (
        <>
          <div className="settings-group-label">Machines you can control</div>
          <div className="settings-group">
            {machines.length === 0 && (
              <div className="setting-row">
                <div className="setting-label">
                  <div className="setting-label-desc">
                    No machines yet. On the other machine, enable “Allow this machine to be
                    controlled” and generate a pairing code, then add it below.
                  </div>
                </div>
              </div>
            )}
            {machines.map((machine) => (
              <div key={machine.id} className="setting-row">
                <div className="setting-label">
                  <div className="setting-label-title">
                    {machine.name}
                    <span className={`remote-status-chip ${machine.status}`}>
                      {machine.status === 'connected'
                        ? 'Connected'
                        : machine.status === 'connecting'
                          ? 'Connecting…'
                          : machine.status === 'error'
                            ? 'Error'
                            : 'Offline'}
                    </span>
                  </div>
                  <div className="setting-label-desc">
                    {machine.host ? `${machine.host}:${machine.port}` : 'Reached over the internet'}
                    {machine.error ? ` — ${machine.error}` : ''}
                  </div>
                </div>
                {machine.status === 'connected' ? (
                  <button
                    type="button"
                    className="archived-epic-action"
                    title="Disconnect"
                    onClick={() => void window.orion?.remoteDisconnectMachine?.({ machineId: machine.id })}
                  >
                    <Unplug size={13} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="archived-epic-action"
                    title="Connect now"
                    disabled={busyId === machine.id}
                    onClick={() => void handleConnectMachine(machine.id)}
                  >
                    <Link2 size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className="archived-epic-action danger"
                  title="Remove this machine"
                  disabled={busyId === machine.id}
                  onClick={() => void handleRemoveMachine(machine.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}

            <div className="setting-row remote-pair-form">
              <div className="setting-label">
                <div className="setting-label-title">Add a machine</div>
                <div className="setting-label-desc">
                  {overInternet
                    ? 'The machine ID and pairing code shown on the machine you want to control.'
                    : 'Address, port, and the pairing code shown on the machine you want to control.'}
                </div>
                <div className="remote-pair-inputs">
                  {overInternet ? (
                    <input
                      type="text"
                      placeholder="Machine ID"
                      value={pairMachineId}
                      onChange={(e) => setPairMachineId(e.target.value)}
                    />
                  ) : (
                    <>
                      <input
                        type="text"
                        placeholder="Host or IP (e.g. 192.168.1.20)"
                        value={pairHost}
                        onChange={(e) => setPairHost(e.target.value)}
                      />
                      <input
                        type="text"
                        className="remote-pair-port"
                        placeholder="Port"
                        value={pairPort}
                        onChange={(e) => setPairPort(e.target.value)}
                      />
                    </>
                  )}
                  <input
                    type="text"
                    placeholder="Pairing code"
                    value={pairCode}
                    onChange={(e) => setPairCode(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn small"
                    disabled={
                      pairing ||
                      !authenticated ||
                      !pairCode.trim() ||
                      (overInternet ? !pairMachineId.trim() : !pairHost.trim())
                    }
                    onClick={() => void handlePair()}
                  >
                    {pairing ? <RefreshCw size={13} className="spinning" /> : <Plus size={13} />}
                    {pairing ? 'Pairing…' : 'Pair'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {!settings.enabled && (
        <div className="settings-group">
          <div className="setting-row">
            <div className="setting-label">
              <div className="setting-label-desc">
                <Cast size={13} className="remote-inline-icon" /> Remote control is off. Nothing
                listens, nothing connects, and the Machines section stays out of the sidebar.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

export default RemoteControlSettings;
