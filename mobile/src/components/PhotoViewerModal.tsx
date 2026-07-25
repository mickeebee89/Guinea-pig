import { View, Image, StyleSheet, TouchableOpacity, Modal, Dimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

const SCREEN_W = Dimensions.get('window').width

// Full-screen photo viewer. Same look as the model-profile gallery viewer, pulled
// out so any screen can enlarge a photo without duplicating the modal.

export default function PhotoViewerModal({
  uri,
  onClose,
}: {
  uri: string | null
  onClose: () => void
}) {
  return (
    <Modal
      visible={!!uri}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.close} onPress={onClose} activeOpacity={0.8}>
          <Ionicons name="close" size={24} color="#fff" />
        </TouchableOpacity>
        {uri ? <Image source={{ uri }} style={styles.img} resizeMode="contain" /> : null}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  close: {
    position: 'absolute',
    top: 52,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  img: { width: SCREEN_W, height: SCREEN_W },
})
