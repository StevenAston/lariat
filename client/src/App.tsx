import { Routes, Route, Link } from 'react-router-dom';
import { Flex, Box, Heading, Link as RadixLink, Container, Grid, Card, Text, DataList, Table, Button, Badge } from '@radix-ui/themes';
import { Activity, Link as LinkIcon, Settings, BarChart2, Database, AlertCircle, Clock, ChevronUp, ChevronDown, CheckSquare, Network } from 'lucide-react';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { LiveLog } from './LiveLog';
import { LinkDetail } from './LinkDetail';
import { BatchPage } from './BatchPage';
import { TopologyPage } from './TopologyPage';
import { SettingsPage } from './SettingsPage';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Flex direction="row" style={{ height: '100vh', width: '100vw' }}>
      <Box p="4" style={{ width: '250px', borderRight: '1px solid var(--gray-a6)', backgroundColor: 'var(--color-panel-solid)' }}>
        <Heading size="6" mb="6" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity /> Lariat
        </Heading>
        <Flex direction="column" gap="4">
          <RadixLink asChild size="3">
            <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BarChart2 size={18} /> Dashboard
            </Link>
          </RadixLink>
          <RadixLink asChild size="3">
            <Link to="/links" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <LinkIcon size={18} /> Links
            </Link>
          </RadixLink>
          <RadixLink asChild size="3">
            <Link to="/topology" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Network size={18} /> Topology Map
            </Link>
          </RadixLink>
          <RadixLink asChild size="3">
            <Link to="/batch" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckSquare size={18} /> Batch Operations
            </Link>
          </RadixLink>
          <RadixLink asChild size="3">
            <Link to="/settings" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Settings size={18} /> Settings
            </Link>
          </RadixLink>
        </Flex>
      </Box>
      <Box p="6" style={{ flex: 1, overflow: 'auto', backgroundColor: 'var(--color-background)' }}>
        <Container size="4">
          {children}
        </Container>
      </Box>
    </Flex>
  );
}

function Dashboard() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['summary'],
    queryFn: () => api.getSummary(),
    refetchInterval: 5000,
  });

  const reconMutation = useMutation({
    mutationFn: () => api.triggerReconciliation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['summary'] }),
  });

  const healthMutation = useMutation({
    mutationFn: () => api.triggerHealthSweep(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['summary'] }),
  });

  return (
    <Flex direction="column" gap="4">
      <Heading>Dashboard</Heading>
      
      {isLoading ? (
        <Text>Loading summary...</Text>
      ) : error ? (
        <Text color="red">Failed to load summary</Text>
      ) : data?.data && (
        <Grid columns="2" gap="4">
          <Card>
            <Flex align="center" gap="2" mb="2">
              <Database size={18} />
              <Text weight="bold">System Totals</Text>
            </Flex>
            <DataList.Root>
              <DataList.Item>
                <DataList.Label>Torrents</DataList.Label>
                <DataList.Value>{data.data.totals.torrents}</DataList.Value>
              </DataList.Item>
              <DataList.Item>
                <DataList.Label>Links</DataList.Label>
                <DataList.Value>{data.data.totals.links}</DataList.Value>
              </DataList.Item>
              <DataList.Item>
                <DataList.Label>Recheck Queue</DataList.Label>
                <DataList.Value>{data.data.recheckQueueDepth}</DataList.Value>
              </DataList.Item>
            </DataList.Root>
          </Card>

          <Card>
            <Flex align="center" gap="2" mb="2">
              <AlertCircle size={18} />
              <Text weight="bold">Link Health</Text>
            </Flex>
            <DataList.Root>
              {Object.entries(data.data.byAnomaly).length === 0 ? (
                <Text color="gray" size="2">No links found</Text>
              ) : (
                Object.entries(data.data.byAnomaly).map(([anomaly, count]) => (
                  <DataList.Item key={anomaly}>
                    <DataList.Label>{anomaly}</DataList.Label>
                    <DataList.Value>
                      <Text color={anomaly === 'healthy' ? 'green' : 'red'} weight="bold">{count}</Text>
                    </DataList.Value>
                  </DataList.Item>
                ))
              )}
            </DataList.Root>
          </Card>

          <Card style={{ gridColumn: 'span 2' }}>
            <Flex justify="between" align="start" mb="2">
              <Flex align="center" gap="2">
                <Clock size={18} />
                <Text weight="bold">Recent Background Tasks</Text>
              </Flex>
              <Flex gap="2">
                <Button 
                  variant="soft" 
                  disabled={reconMutation.isPending} 
                  onClick={() => reconMutation.mutate()}
                >
                  Trigger Reconciliation
                </Button>
                <Button 
                  variant="soft" 
                  disabled={healthMutation.isPending} 
                  onClick={() => healthMutation.mutate()}
                >
                  Trigger Health Sweep
                </Button>
              </Flex>
            </Flex>
            <DataList.Root>
              <DataList.Item>
                <DataList.Label>Last Reconciliation</DataList.Label>
                <DataList.Value>
                  {data.data.lastReconciliation ? new Date(data.data.lastReconciliation).toLocaleString() : 'Never'}
                </DataList.Value>
              </DataList.Item>
              <DataList.Item>
                <DataList.Label>Last Health Sweep</DataList.Label>
                <DataList.Value>
                  {data.data.lastHealthSweep ? new Date(data.data.lastHealthSweep).toLocaleString() : 'Never'}
                </DataList.Value>
              </DataList.Item>
            </DataList.Root>
          </Card>
        </Grid>
      )}

      <LiveLog />
    </Flex>
  );
}

function Links() {
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('id');
  const [sortDesc, setSortDesc] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ['links', page, sortBy, sortDesc],
    queryFn: () => api.getLinks({ page, limit: 15, sortBy, sortDesc }),
  });

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortDesc(!sortDesc);
    } else {
      setSortBy(field);
      setSortDesc(false);
    }
    setPage(1); // Reset to first page when sorting changes
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return null;
    return sortDesc ? <ChevronDown size={14} style={{ display: 'inline' }} /> : <ChevronUp size={14} style={{ display: 'inline' }} />;
  };

  const thStyle = { cursor: 'pointer' };

  return (
    <Flex direction="column" gap="4">
      <Heading>Links Database</Heading>
      <Card>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell onClick={() => toggleSort('id')} style={thStyle}>ID <SortIcon field="id" /></Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell onClick={() => toggleSort('hash')} style={thStyle}>Hash <SortIcon field="hash" /></Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell onClick={() => toggleSort('file_name')} style={thStyle}>File Name <SortIcon field="file_name" /></Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell onClick={() => toggleSort('current_health')} style={thStyle}>Health <SortIcon field="current_health" /></Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell onClick={() => toggleSort('swap_status')} style={thStyle}>Status <SortIcon field="swap_status" /></Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {isLoading ? (
              <Table.Row>
                <Table.Cell colSpan={5}><Text>Loading...</Text></Table.Cell>
              </Table.Row>
            ) : data?.data?.links?.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={5}><Text color="gray">No links found</Text></Table.Cell>
              </Table.Row>
            ) : (
              data?.data?.links.map((link) => (
                <Table.Row key={link.id}>
                  <Table.Cell>
                    <Link to={`/links/${link.id}`} style={{ color: 'var(--accent-9)', textDecoration: 'none', fontWeight: 'bold' }}>
                      {link.id}
                    </Link>
                  </Table.Cell>
                  <Table.Cell><Text style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{link.hash?.substring(0, 12)}...</Text></Table.Cell>
                  <Table.Cell>{link.file_name}</Table.Cell>
                  <Table.Cell>
                    <Badge color={link.current_health === 'healthy' ? 'green' : 'red'}>
                      {link.current_health}
                    </Badge>
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

        {data?.data?.pagination && (
          <Flex justify="between" align="center" mt="4">
            <Text size="2" color="gray">
              Showing page {data.data.pagination.page} of {data.data.pagination.totalPages} ({data.data.pagination.total} total)
            </Text>
            <Flex gap="2">
              <Button 
                variant="soft" 
                disabled={page === 1} 
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button 
                variant="soft" 
                disabled={page >= data.data.pagination.totalPages} 
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </Button>
            </Flex>
          </Flex>
        )}
      </Card>
    </Flex>
  );
}


export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/links" element={<Links />} />
        <Route path="/links/:id" element={<LinkDetail />} />
        <Route path="/topology" element={<TopologyPage />} />
        <Route path="/batch" element={<BatchPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Shell>
  );
}
