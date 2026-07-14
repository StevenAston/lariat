import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Flex, Heading, Card, Text, Table, Button, Badge, Checkbox } from '@radix-ui/themes';
import { api } from './api';

export function BatchPage() {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['links', 'batch'],
    queryFn: () => api.getLinks({ limit: 1000 }), // Get all for batch page for now
  });

  const batchMutation = useMutation({
    mutationFn: ({ action, ids }: { action: 'delete' | 're-import', ids: number[] }) => api.batchAction(action, ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['links'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      setSelectedIds(new Set());
    },
  });

  const links = data?.data?.links || [];

  // Filter to show only anomalies
  const anomalyLinks = links.filter(l => l.current_health !== 'healthy');

  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === anomalyLinks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(anomalyLinks.map(l => l.id)));
    }
  };

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center">
        <Heading>Batch Operations</Heading>
        <Flex gap="2">
          <Button 
            color="red" 
            variant="soft" 
            disabled={selectedIds.size === 0 || batchMutation.isPending}
            onClick={() => batchMutation.mutate({ action: 'delete', ids: Array.from(selectedIds) })}
          >
            Delete Selected ({selectedIds.size})
          </Button>
          <Button 
            color="blue" 
            variant="soft" 
            disabled={selectedIds.size === 0 || batchMutation.isPending}
            onClick={() => batchMutation.mutate({ action: 're-import', ids: Array.from(selectedIds) })}
          >
            Re-import Selected ({selectedIds.size})
          </Button>
        </Flex>
      </Flex>

      <Card>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>
                <Checkbox 
                  checked={anomalyLinks.length > 0 && selectedIds.size === anomalyLinks.length}
                  onCheckedChange={toggleSelectAll}
                />
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>ID</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>File Name</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Health</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {isLoading ? (
              <Table.Row>
                <Table.Cell colSpan={5}><Text>Loading...</Text></Table.Cell>
              </Table.Row>
            ) : anomalyLinks.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={5}><Text color="gray">No anomalies found. Everything is healthy!</Text></Table.Cell>
              </Table.Row>
            ) : (
              anomalyLinks.map((link) => (
                <Table.Row key={link.id}>
                  <Table.Cell>
                    <Checkbox 
                      checked={selectedIds.has(link.id)}
                      onCheckedChange={() => toggleSelect(link.id)}
                    />
                  </Table.Cell>
                  <Table.Cell>{link.id}</Table.Cell>
                  <Table.Cell>{link.file_name}</Table.Cell>
                  <Table.Cell>
                    <Badge color="red">{link.current_health}</Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge color={link.swap_status === 'success' ? 'green' : link.swap_status === 'failed' ? 'red' : 'yellow'}>
                      {link.swap_status}
                    </Badge>
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table.Root>
      </Card>
    </Flex>
  );
}
