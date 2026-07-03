import { useEffect, useState } from "react";
import {
  DEFAULT_SUBSCRIPTION_MESSAGES,
  subscribeSubscriptionMessages,
  type SubscriptionMessages,
} from "@/lib/firebase/subscriptionMessages";

export function useSubscriptionMessages(): SubscriptionMessages {
  const [m, setM] = useState<SubscriptionMessages>(DEFAULT_SUBSCRIPTION_MESSAGES);
  useEffect(() => subscribeSubscriptionMessages(setM), []);
  return m;
}