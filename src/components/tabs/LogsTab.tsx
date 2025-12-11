import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { usePaperStats } from '@/hooks/usePaperTrading';

const levelColors: Record<string, string> = {
  info: 'bg-primary/20 text-primary',
  warn: 'bg-warning/20 text-warning',
  error: 'bg-destructive/20 text-destructive',
};

const sourceColors: Record<string, string> = {
  execution: 'bg-chart-1/20 text-chart-1',
  broker: 'bg-chart-2/20 text-chart-2',
  risk: 'bg-chart-3/20 text-chart-3',
  ai: 'bg-chart-4/20 text-chart-4',
  burst: 'bg-chart-5/20 text-chart-5',
};

export function LogsTab() {
  const { data: paperData, isLoading } = usePaperStats();
  const logs = paperData?.logs || [];

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle>System Logs</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading logs...</div>
        ) : logs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No logs yet</div>
        ) : (
          <div className="max-h-[600px] overflow-auto scrollbar-hide">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Timestamp</TableHead>
                  <TableHead className="w-20">Level</TableHead>
                  <TableHead className="w-24">Source</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge className={levelColors[log.level || 'info']}>
                        {(log.level || 'info').toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={sourceColors[log.source || 'execution']}>
                        {log.source}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {log.message}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}