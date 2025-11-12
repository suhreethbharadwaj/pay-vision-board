import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const AdminPanel = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate('/')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Admin Panel</h1>
            <p className="text-muted-foreground">Manage system settings and users</p>
          </div>
        </div>

        <Card className="p-6">
          <p className="text-muted-foreground">Admin features coming soon...</p>
        </Card>
      </div>
    </div>
  );
};

export default AdminPanel;
