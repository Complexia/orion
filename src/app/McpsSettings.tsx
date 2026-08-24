import React from 'react';
import { RefreshCw } from 'lucide-react';
import type { McpEntry } from '../types';

const transportLabel = (transport: string) => {
  if (transport === 'stdio') return 'Local';
  if (transport === 'http') return 'HTTP';
  if (transport === 'sse') return 'SSE';
  return transport === 'unknown' ? 'MCP' : transport.toUpperCase();
};

const McpsSettings = React.memo(function McpsSettings() {
  const [mcps, setMcps] = React.useState<McpEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = React.useCallback(async (options?: { preserveMessage?: boolean }) => {
    if (!window.orion?.listMcps) {
      setLoading(false);
      setError('This build of Orion cannot manage MCP servers. Restart the app after updating.');
      return;
    }
    setLoading(true);
    try {
      const result = await window.orion.listMcps();
      if (!mountedRef.current) return;
      setMcps(result?.mcps ?? []);
      if (result?.ok === false) setError(result.error ?? 'Could not read configured MCP servers.');
      else if (!options?.preserveMessage) setError(null);
    } catch (caught) {
      if (mountedRef.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleToggle = React.useCallback(
    async (mcp: McpEntry, enabled: boolean) => {
      if (!window.orion?.setMcpEnabled) return;
      setBusyId(mcp.id);
      setMcps((current) =>
        current.map((entry) => (entry.id === mcp.id ? { ...entry, enabled } : entry))
      );
      let failed = false;
      try {
        const result = await window.orion.setMcpEnabled({ id: mcp.id, enabled });
        if (!mountedRef.current) return;
        failed = !result?.ok;
        if (failed) setError(result?.error ?? `Could not ${enabled ? 'enable' : 'disable'} ${mcp.name}.`);
        else setError(null);
      } catch (caught) {
        failed = true;
        if (mountedRef.current) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (mountedRef.current) setBusyId(null);
        await refresh({ preserveMessage: failed });
      }
    },
    [refresh]
  );

  const query = search.trim().toLowerCase();
  const visibleMcps = query
    ? mcps.filter((mcp) =>
        `${mcp.name} ${mcp.transport} ${mcp.detail ?? ''}`.toLowerCase().includes(query)
      )
    : mcps;
  const activeCount = mcps.filter((mcp) => mcp.enabled).length;

  return (
    <>
      <div className="settings-group-label">Configured MCPs</div>
      <div className="settings-group">
        <div className="skills-toolbar">
          <div className="skills-toolbar-main">
            <div className="skills-toolbar-total">
              {loading && mcps.length === 0
                ? 'Reading MCP servers...'
                : `${mcps.length} MCP${mcps.length === 1 ? '' : 's'} · ${activeCount} active`}
            </div>
            <div className="skills-toolbar-caption">
              MCP servers come from your Codex configuration and installed Codex plugins. Active servers are included
              in new Codex turns run through Orion. These toggles only change Orion; your underlying Codex setup stays
              intact.
            </div>
          </div>
          <div className="skills-toolbar-actions">
            <button
              type="button"
              className="btn secondary small"
              disabled={loading}
              onClick={() => void refresh()}
              title="Re-read configured MCP servers"
            >
              <RefreshCw size={13} className={loading ? 'spinning' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {error && <div className="skills-message error">{error}</div>}

        {mcps.length > 6 && (
          <div className="skills-filter">
            <input
              type="text"
              className="skills-filter-input"
              placeholder="Filter MCPs"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        )}

        {!loading && mcps.length === 0 && !error && (
          <div className="setting-row">
            <div className="setting-label">
              <div className="setting-label-desc">
                No MCP servers are configured. Add one with Codex, then refresh this list.
              </div>
            </div>
          </div>
        )}

        {mcps.length > 0 && visibleMcps.length === 0 && (
          <div className="setting-row">
            <div className="setting-label">
              <div className="setting-label-desc">No MCP matches “{search.trim()}”.</div>
            </div>
          </div>
        )}

        {visibleMcps.length > 0 && (
          <div className="skills-list">
            {visibleMcps.map((mcp) => {
              const busy = busyId === mcp.id;
              return (
                <div key={mcp.id} className={`skills-row${mcp.enabled ? '' : ' inactive'}`}>
                  <div className="skills-row-main">
                    <div className="skills-row-head">
                      <div className="mcp-row-name truncate" title={mcp.name}>
                        {mcp.name}
                      </div>
                      {!mcp.enabled && <span className="provider-status-chip">Inactive</span>}
                    </div>
                    <div className="skills-row-desc">
                      {transportLabel(mcp.transport)} MCP server
                      {mcp.detail ? ` · ${mcp.detail}` : ''}
                    </div>
                    <div className="skills-row-meta truncate">
                      Codex{mcp.authStatus ? ` · ${mcp.authStatus.replaceAll('_', ' ')}` : ''}
                      {mcp.enabled !== mcp.configuredEnabled ? ' · Orion override' : ''}
                    </div>
                  </div>
                  <label className="provider-toggle" title={mcp.enabled ? 'Disable this MCP' : 'Enable this MCP'}>
                    <input
                      type="checkbox"
                      checked={mcp.enabled}
                      disabled={busy}
                      onChange={(event) => void handleToggle(mcp, event.target.checked)}
                    />
                    <span />
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
});

export default McpsSettings;
