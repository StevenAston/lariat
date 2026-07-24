import { useState, useEffect } from 'react';
import { Flex, Heading, Card, Text, Button, TextField, Switch, Grid, Box } from '@radix-ui/themes';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['config'],
    queryFn: () => api.getConfig(),
  });

  const [formData, setFormData] = useState<any>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (data?.success && data.data) {
      setFormData(data.data);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (newConfig: any) => api.saveConfig(newConfig),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      alert('Configuration saved successfully!');
    },
    onError: (err: Error) => {
      alert(`Failed to save: ${err.message}`);
    }
  });

  if (isLoading) return <Text>Loading config...</Text>;
  if (error || !data?.success) return <Text color="red">Failed to load configuration</Text>;

  const handleChange = (path: string, value: any) => {
    setFormData((prev: any) => {
      const next = { ...prev };
      const parts = path.split('.');
      let current = next;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) current[parts[i]] = {};
        current[parts[i]] = { ...current[parts[i]] };
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
      return next;
    });
  };

  const handleArrayChange = (path: string, val: string) => {
    const arr = val.split(',').map(s => s.trim()).filter(Boolean);
    handleChange(path, arr);
  };

  const handleSave = () => {
    saveMutation.mutate(formData);
  };

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center">
        <Heading>Settings</Heading>
        <Flex gap="4" align="center">
          <Flex align="center" gap="2">
            <Switch checked={showAdvanced} onCheckedChange={setShowAdvanced} />
            <Text size="2">Advanced</Text>
          </Flex>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </Flex>
      </Flex>

      <Grid columns="2" gap="4">
        {/* GENERAL */}
        <Card>
          <Heading size="3" mb="3">General</Heading>
          <Flex direction="column" gap="3">
            <label>
              <Text size="2" weight="bold">Log File</Text>
              <TextField.Root value={formData.logFile || ''} onChange={e => handleChange('logFile', e.target.value)} />
            </label>
            <label>
              <Flex gap="2" align="center" mt="2">
                <Switch checked={formData.interactiveMode || false} onCheckedChange={v => handleChange('interactiveMode', v)} />
                <Text size="2" weight="bold">Interactive Approval Mode</Text>
              </Flex>
            </label>
            <label>
              <Text size="2" weight="bold">Video Extensions (comma separated)</Text>
              <TextField.Root 
                value={(formData.videoExtensions || []).join(', ')} 
                onChange={e => handleArrayChange('videoExtensions', e.target.value)} 
              />
            </label>
          </Flex>
        </Card>

        {/* QBITTORRENT */}
        <Card>
          <Heading size="3" mb="3">qBittorrent</Heading>
          <Flex direction="column" gap="3">
            <label>
              <Text size="2" weight="bold">Host</Text>
              <TextField.Root value={formData.QBT_HOST || ''} onChange={e => handleChange('QBT_HOST', e.target.value)} />
            </label>
            <label>
              <Text size="2" weight="bold">Port</Text>
              <TextField.Root type="number" value={formData.QBT_PORT || ''} onChange={e => handleChange('QBT_PORT', Number(e.target.value))} />
            </label>
            <label>
              <Text size="2" weight="bold">Username</Text>
              <TextField.Root value={formData.QBT_USER || ''} onChange={e => handleChange('QBT_USER', e.target.value)} />
            </label>
            <label>
              <Text size="2" weight="bold">Password</Text>
              <TextField.Root type="password" value={formData.QBT_PASS || ''} onChange={e => handleChange('QBT_PASS', e.target.value)} />
            </label>
          </Flex>
        </Card>

        {/* SONARR */}
        <Card>
          <Heading size="3" mb="3">Sonarr</Heading>
          <Flex direction="column" gap="3">
            <label>
              <Text size="2" weight="bold">URL</Text>
              <TextField.Root value={formData.SONARR_URL || ''} onChange={e => handleChange('SONARR_URL', e.target.value)} />
            </label>
            <label>
              <Text size="2" weight="bold">API Key</Text>
              <TextField.Root type="password" value={formData.SONARR_API_KEY || ''} onChange={e => handleChange('SONARR_API_KEY', e.target.value)} />
            </label>
          </Flex>
        </Card>

        {/* RADARR */}
        <Card>
          <Heading size="3" mb="3">Radarr</Heading>
          <Flex direction="column" gap="3">
            <label>
              <Text size="2" weight="bold">URL</Text>
              <TextField.Root value={formData.RADARR_URL || ''} onChange={e => handleChange('RADARR_URL', e.target.value)} />
            </label>
            <label>
              <Text size="2" weight="bold">API Key</Text>
              <TextField.Root type="password" value={formData.RADARR_API_KEY || ''} onChange={e => handleChange('RADARR_API_KEY', e.target.value)} />
            </label>
          </Flex>
        </Card>

        {/* DRIVEPOOL */}
        <Card>
          <Heading size="3" mb="3">DrivePool</Heading>
          <Flex direction="column" gap="3">
            <label>
              <Flex gap="2" align="center" mt="2">
                <Switch checked={formData.drivePool?.enabled || false} onCheckedChange={v => handleChange('drivePool.enabled', v)} />
                <Text size="2" weight="bold">Enable DrivePool Integration</Text>
              </Flex>
            </label>
            <label>
              <Text size="2" weight="bold">Mount Point</Text>
              <TextField.Root value={formData.drivePool?.mount || ''} onChange={e => handleChange('drivePool.mount', e.target.value)} />
            </label>
            <label>
              <Text size="2" weight="bold">Disks (comma separated)</Text>
              <TextField.Root 
                value={(formData.drivePool?.disks || []).join(', ')} 
                onChange={e => handleArrayChange('drivePool.disks', e.target.value)} 
              />
            </label>
          </Flex>
        </Card>
      </Grid>

      {/* ADVANCED */}
      {showAdvanced && (
        <>
          <Heading size="4" mt="4">Advanced Settings</Heading>
          <Grid columns="2" gap="4">
            <Card>
              <Heading size="3" mb="3">Integrity & Storage</Heading>
              <Flex direction="column" gap="3">
                <label>
                  <Flex gap="2" align="center" mt="2">
                    <Switch checked={formData.integrity?.enabled || false} onCheckedChange={v => handleChange('integrity.enabled', v)} />
                    <Text size="2" weight="bold">Enable Merkle Integrity</Text>
                  </Flex>
                </label>
                <label>
                  <Text size="2" weight="bold">Hash Throttle (ms)</Text>
                  <TextField.Root type="number" value={formData.integrity?.hashThrottleMs || ''} onChange={e => handleChange('integrity.hashThrottleMs', Number(e.target.value))} />
                </label>
                <label>
                  <Text size="2" weight="bold">wBytes (Region Size)</Text>
                  <TextField.Root type="number" value={formData.integrity?.wBytes || ''} onChange={e => handleChange('integrity.wBytes', Number(e.target.value))} />
                </label>
                <label>
                  <Text size="2" weight="bold">Import Mode</Text>
                  <Box mt="1">
                    <select 
                      value={formData.importMode || 'copy'} 
                      onChange={e => handleChange('importMode', e.target.value)}
                      style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--gray-a7)', width: '100%', background: 'var(--color-surface)', color: 'var(--gray-12)' }}
                    >
                      <option value="copy">Copy</option>
                      <option value="move">Move</option>
                    </select>
                  </Box>
                </label>
              </Flex>
            </Card>

            <Card>
              <Heading size="3" mb="3">Tuning & Thresholds</Heading>
              <Flex direction="column" gap="3">
                <label>
                  <Text size="2" weight="bold">Debounce Ms</Text>
                  <TextField.Root type="number" value={formData.debounceMs || ''} onChange={e => handleChange('debounceMs', Number(e.target.value))} />
                </label>
                <label>
                  <Text size="2" weight="bold">Recheck Timeout (s)</Text>
                  <TextField.Root type="number" value={formData.timeouts?.recheck || ''} onChange={e => handleChange('timeouts.recheck', Number(e.target.value))} />
                </label>
                <label>
                  <Text size="2" weight="bold">Health Check Schedule</Text>
                  <TextField.Root value={formData.schedules?.healthCheck || ''} onChange={e => handleChange('schedules.healthCheck', e.target.value)} />
                </label>
                <label>
                  <Text size="2" weight="bold">Theta (Missing File Threshold)</Text>
                  <TextField.Root type="number" step="0.01" value={formData.thresholds?.theta || ''} onChange={e => handleChange('thresholds.theta', Number(e.target.value))} />
                </label>
              </Flex>
            </Card>
          </Grid>
        </>
      )}
    </Flex>
  );
}
