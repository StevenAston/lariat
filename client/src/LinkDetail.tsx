import { useParams, Link as RouterLink } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Flex, Box, Heading, Card, Text, DataList, Badge, Button, Callout } from '@radix-ui/themes';
import { ArrowLeft, RefreshCw, Activity } from 'lucide-react';
import { api } from './api';

export function LinkDetail() {
  const { id } = useParams();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['link', id],
    queryFn: () => api.getLink(id!),
    enabled: !!id,
  });

  const recheckMutation = useMutation({
    mutationFn: (hash: string) => api.triggerRecheck(hash),
    onSuccess: () => {
      // Re-fetch after a short delay or immediately
      queryClient.invalidateQueries({ queryKey: ['link', id] });
    },
  });

  if (isLoading) return <Text>Loading...</Text>;
  if (error || !data?.success) return <Text color="red">Failed to load link details.</Text>;

  const { link, healthCheck, events } = data.data;

  let healthDetail = null;
  try {
    if (healthCheck?.detail) {
      healthDetail = JSON.parse(healthCheck.detail);
    }
  } catch (e) {}

  return (
    <Flex direction="column" gap="4">
      <Flex align="center" gap="4">
        <Button variant="ghost" asChild>
          <RouterLink to="/links">
            <ArrowLeft size={16} /> Back
          </RouterLink>
        </Button>
        <Heading>Link #{link.id}</Heading>
        <Badge color={link.current_health === 'healthy' ? 'green' : 'red'} size="2">
          {link.current_health}
        </Badge>
      </Flex>

      <Card size="2">
        <Flex justify="between" align="start" mb="4">
          <Heading size="4">Torrent Info</Heading>
          <Button 
            disabled={recheckMutation.isPending || !link.hash} 
            onClick={() => recheckMutation.mutate(link.hash)}
          >
            <RefreshCw size={16} /> 
            {recheckMutation.isPending ? 'Rechecking...' : 'Trigger Recheck'}
          </Button>
        </Flex>

        <DataList.Root>
          <DataList.Item>
            <DataList.Label>Hash</DataList.Label>
            <DataList.Value style={{ fontFamily: 'var(--mono)' }}>{link.hash}</DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label>File Name</DataList.Label>
            <DataList.Value>{link.file_name}</DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label>File Size</DataList.Label>
            <DataList.Value>{link.file_size} bytes</DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label>Swap Status / Mode</DataList.Label>
            <DataList.Value>
              <Badge color={link.swap_status === 'success' ? 'green' : link.swap_status === 'failed' ? 'red' : 'yellow'}>
                {link.swap_status}
              </Badge>
              <Text ml="2" color="gray">({link.swap_mode})</Text>
            </DataList.Value>
          </DataList.Item>
        </DataList.Root>
      </Card>

      <Card size="2">
        <Heading size="4" mb="4">Paths & Diagnostics</Heading>
        <DataList.Root>
          <DataList.Item>
            <DataList.Label>QBT Land Path</DataList.Label>
            <DataList.Value style={{ fontFamily: 'var(--mono)' }}>{link.qbt_land_path}</DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label>Plex Land Path</DataList.Label>
            <DataList.Value style={{ fontFamily: 'var(--mono)' }}>{link.plex_land_path}</DataList.Value>
          </DataList.Item>
        </DataList.Root>

        {healthCheck && (
          <Box mt="4">
            <Callout.Root color={link.current_health === 'healthy' ? 'green' : 'red'}>
              <Callout.Icon>
                <Activity size={18} />
              </Callout.Icon>
              <Callout.Text>
                <Text weight="bold">Latest Health Sweep ({new Date(healthCheck.created_at).toLocaleString()})</Text>
                {healthDetail && (
                  <DataList.Root mt="2">
                    <DataList.Item>
                      <DataList.Label>QBT Path Exists</DataList.Label>
                      <DataList.Value>{healthDetail.qbtPathExists ? 'Yes' : 'No'}</DataList.Value>
                    </DataList.Item>
                    <DataList.Item>
                      <DataList.Label>Plex Path Exists</DataList.Label>
                      <DataList.Value>{healthDetail.plexPathExists ? 'Yes' : 'No'}</DataList.Value>
                    </DataList.Item>
                    <DataList.Item>
                      <DataList.Label>QBT Path is Symlink</DataList.Label>
                      <DataList.Value>{healthDetail.qbtPathIsSymlink ? 'Yes' : 'No'}</DataList.Value>
                    </DataList.Item>
                  </DataList.Root>
                )}
              </Callout.Text>
            </Callout.Root>
          </Box>
        )}
      </Card>

      <Card size="2">
        <Heading size="4" mb="4">Recent Events</Heading>
        {events && events.length > 0 ? (
          <Flex direction="column" gap="2">
            {events.map((ev: any) => (
              <Box key={ev.id} p="2" style={{ backgroundColor: 'var(--gray-a3)', borderRadius: 'var(--radius-2)' }}>
                <Flex justify="between">
                  <Text weight="bold">{ev.type}</Text>
                  <Text size="2" color="gray">{new Date(ev.created_at).toLocaleString()}</Text>
                </Flex>
                <Text size="2">{ev.message}</Text>
                {ev.detail && (
                  <Text size="1" color="gray" style={{ display: 'block', marginTop: '4px' }}>
                    {ev.detail}
                  </Text>
                )}
              </Box>
            ))}
          </Flex>
        ) : (
          <Text color="gray">No events recorded.</Text>
        )}
      </Card>
    </Flex>
  );
}
