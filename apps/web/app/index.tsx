import { Text, View } from "react-native";

export default function Home() {
  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-neutral-950">
      <Text className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">Privance</Text>
      <Text className="mt-2 text-sm text-neutral-500">Zero-knowledge personal finance</Text>
    </View>
  );
}
