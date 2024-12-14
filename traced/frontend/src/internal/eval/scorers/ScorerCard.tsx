import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GitBranchIcon } from 'lucide-react';

import { ScorerCardProps } from '@/types/eval';

export const ScorerCard: React.FC<ScorerCardProps> = ({
  name,
  type,
  metaInfo,
  gitInfo,
  createdAt,
}) => {
  return (
    <Card className="w-full mb-4 hover:shadow-md transition-shadow">
      <CardHeader>
        <div className="flex justify-between items-start">
          <CardTitle className="text-lg font-semibold">{name}</CardTitle>
          {gitInfo?.branch && (
            <div className="flex items-center text-sm text-green-600">
              <GitBranchIcon className="h-4 w-4 mr-1" />
              <span>{gitInfo.branch}::{gitInfo.commit?.slice(0, 7)}</span>
            </div>
          )}
        </div>
        <CardDescription>
          Type: {type}
          <br />
          Created: {new Date(createdAt).toLocaleDateString()}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="text-sm font-medium">Configuration:</div>
          <div className="text-sm bg-gray-50 p-2 rounded">
            <pre className="whitespace-pre-wrap">
              {JSON.stringify(metaInfo, null, 2)}
            </pre>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}; 