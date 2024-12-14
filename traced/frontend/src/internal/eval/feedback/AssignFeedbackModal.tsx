import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from '@/hooks/use-toast';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";

interface AssignFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: string[];
  selectedRows: number;
  onAssign: (userEmails: string[], assignmentType: string, dueDate?: Date) => Promise<void>;
}

export const AssignFeedbackModal: React.FC<AssignFeedbackModalProps> = ({
  isOpen,
  onClose,
  users = [],
  selectedRows,
  onAssign,
}) => {
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [assignmentType, setAssignmentType] = useState<string>("required");
  const [searchQuery, setSearchQuery] = useState("");
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const { toast } = useToast();

  React.useEffect(() => {
    if (!isOpen) {
      setSelectedUsers([]);
      setAssignmentType("required");
      setSearchQuery("");
      setDueDate(undefined);
    }
  }, [isOpen]);

  const handleAssign = async () => {
    try {
      toast({
        title: "Assigning",
        description: "Assigning feedback tasks...",
        variant: "default",
      });
      
      await onAssign(selectedUsers, assignmentType, dueDate);
      
      toast({
        title: "Success",
        description: "Feedback tasks assigned successfully",
        variant: "default",
      });
      
      setSelectedUsers([]);
      setAssignmentType("required");
      onClose();
    } catch (error) {
      console.error('Error assigning feedback:', error);
      toast({
        title: "Error",
        description: "Failed to assign feedback tasks",
        variant: "destructive",
      });
    }
  };

  const handleSelect = (email: string) => {
    setSelectedUsers(prev => {
      if (prev.includes(email)) {
        return prev.filter(e => e !== email);
      }
      return [...prev, email];
    });
  };

  const handleRemove = (email: string) => {
    setSelectedUsers(prev => prev.filter(e => e !== email));
  };

  const handleSelectAll = () => {
    if (selectedUsers.length === filteredUsers.length) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(filteredUsers);
    }
  };

  const filteredUsers = users.filter(email => 
    email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-white max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Assign Feedback ({selectedRows} rows)</DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="flex-1">
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Select Users</Label>
              <div className="relative">
                <div className="flex gap-1 flex-wrap border rounded-md p-1 mb-2 min-h-[38px]">
                  {selectedUsers.map(email => (
                    <Badge 
                      key={email} 
                      variant="secondary"
                      className="bg-slate-200 text-slate-900"
                    >
                      <span className="text-sm font-['Arial']">{email}</span>
                      <button
                        className="ml-1 ring-offset-background rounded-full outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleRemove(email);
                          }
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={() => handleRemove(email)}
                      >
                        <X className="h-3 w-3 text-slate-600 hover:text-slate-900" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="border rounded-md">
                  <Input
                    placeholder="Search users..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="border-0"
                  />
                  <div className="border-t px-2 py-1">
                    <div
                      onClick={handleSelectAll}
                      className="flex items-center gap-2 p-2 hover:bg-slate-100 cursor-pointer rounded-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedUsers.length === filteredUsers.length && filteredUsers.length > 0}
                        onChange={() => {}}
                        className="h-4 w-4"
                      />
                      <span className="text-sm font-['Arial']">Select All</span>
                    </div>
                  </div>
                  <ScrollArea className="h-[200px]">
                    <div className="p-2">
                      {filteredUsers.length === 0 ? (
                        <div className="text-sm text-muted-foreground p-2">
                          No users found.
                        </div>
                      ) : (
                        filteredUsers.map(email => (
                          <div
                            key={email}
                            onClick={() => handleSelect(email)}
                            className="flex items-center gap-2 p-2 hover:bg-slate-100 cursor-pointer rounded-sm"
                          >
                            <input
                              type="checkbox"
                              checked={selectedUsers.includes(email)}
                              onChange={() => {}}
                              className="h-4 w-4"
                            />
                            <span className="text-sm font-['Arial']">{email}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Assignment Type</Label>
              <RadioGroup
                value={assignmentType}
                onValueChange={setAssignmentType}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="required" id="required" />
                  <Label htmlFor="required">Required (All users must complete)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="pool" id="pool" />
                  <Label htmlFor="pool">Pool (First come, first serve)</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="grid gap-2">
              <Label>Due Date (Optional)</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={`w-full justify-start text-left font-normal ${!dueDate && "text-muted-foreground"}`}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dueDate ? format(dueDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dueDate}
                    onSelect={setDueDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="mt-2">
          <Button
            variant="outline"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            onClick={handleAssign}
            disabled={selectedUsers.length === 0}
          >
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}; 