import { useState, useEffect, useRef } from 'react';
import { Box, Flex, Heading, Select, Card, Text, Badge, Container } from '@radix-ui/themes';
import { api } from './api';
import { TopologyOverlay } from './components/TopologyOverlay';
import { ExclamationTriangleIcon, CheckCircledIcon } from '@radix-ui/react-icons';

export interface TopologyNode {
  id: string;
  column: 'arr' | 'library' | 'symlink' | 'qbt';
  label: string;
  sublabel?: string;
  health: string;
}

export interface TopologyConnection {
  fromId: string;
  toId: string;
  status: 'linked' | 'broken';
}

export interface TopologyData {
  nodes: TopologyNode[];
  connections: TopologyConnection[];
}

export function TopologyPage() {
  const [lens, setLens] = useState<string>('broken');
  const [data, setData] = useState<TopologyData | null>(null);
  const [loading, setLoading] = useState(true);
  
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchTopology();
  }, [lens]);

  const fetchTopology = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/topology?lens=${lens}`);
      setData(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getNodesForColumn = (col: string) => {
    if (!data) return [];
    return data.nodes.filter(n => n.column === col);
  };

  const NodeCard = ({ node }: { node: TopologyNode }) => {
    const isHealthy = node.health === 'healthy';
    const isMissing = node.label === 'Missing';
    
    return (
      <Card 
        data-node-id={node.id} 
        variant="surface"
        className="topology-node"
        style={{ 
          marginBottom: '1rem', 
          borderColor: isMissing ? 'var(--red-8)' : undefined,
          background: isMissing ? 'var(--red-2)' : undefined,
          position: 'relative',
          zIndex: 1
        }}
      >
        <Flex direction="column" gap="1">
          <Flex align="center" justify="between">
            <Text size="2" weight="bold" style={{ wordBreak: 'break-all' }}>{node.label}</Text>
            {isMissing ? (
              <ExclamationTriangleIcon color="red" />
            ) : isHealthy ? (
              <CheckCircledIcon color="green" />
            ) : (
              <ExclamationTriangleIcon color="orange" />
            )}
          </Flex>
          {node.sublabel && (
            <Text size="1" color="gray">{node.sublabel}</Text>
          )}
          {!isMissing && (
            <Badge size="1" color={isHealthy ? "green" : "orange"} variant="soft">
              {node.health}
            </Badge>
          )}
        </Flex>
      </Card>
    );
  };

  return (
    <Box p="4" style={{ height: '100%', overflowY: 'auto' }}>
      <Flex justify="between" align="center" mb="4">
        <Heading size="5">Topology View</Heading>
        <Flex align="center" gap="3">
          <Text size="2" weight="bold">Lens:</Text>
          <Select.Root value={lens} onValueChange={setLens}>
            <Select.Trigger />
            <Select.Content>
              <Select.Item value="broken">Broken / Anomalous</Select.Item>
              <Select.Item value="healthy">Fully Linked</Select.Item>
              <Select.Item value="batch">Batch Candidates</Select.Item>
            </Select.Content>
          </Select.Root>
        </Flex>
      </Flex>
      
      {loading ? (
        <Text>Loading topology map...</Text>
      ) : !data || data.nodes.length === 0 ? (
        <Card>
          <Text color="gray">No links found for the current lens.</Text>
        </Card>
      ) : (
        <Box style={{ position: 'relative' }} ref={containerRef}>
          <TopologyOverlay connections={data.connections} containerRef={containerRef} />
          
          <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4rem', padding: '2rem 0' }}>
            {/* Arr Column */}
            <Box>
              <Heading size="3" mb="4" style={{ textAlign: 'center' }}>Arr Metadata</Heading>
              {getNodesForColumn('arr').map(n => <NodeCard key={n.id} node={n} />)}
            </Box>
            
            {/* Library Column */}
            <Box>
              <Heading size="3" mb="4" style={{ textAlign: 'center' }}>Plex Library</Heading>
              {getNodesForColumn('library').map(n => <NodeCard key={n.id} node={n} />)}
            </Box>
            
            {/* Symlink Column */}
            <Box>
              <Heading size="3" mb="4" style={{ textAlign: 'center' }}>Torrents Folder</Heading>
              {getNodesForColumn('symlink').map(n => <NodeCard key={n.id} node={n} />)}
            </Box>
            
            {/* QBT Column */}
            <Box>
              <Heading size="3" mb="4" style={{ textAlign: 'center' }}>QBT Torrent</Heading>
              {getNodesForColumn('qbt').map(n => <NodeCard key={n.id} node={n} />)}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}
