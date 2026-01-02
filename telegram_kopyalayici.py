import os
import shutil
import sys
import subprocess
from datetime import datetime

# Bağımlılık kontrolü ve yükleme
def check_dependencies():
    try:
        from PyQt5.QtWidgets import QApplication
    except ImportError:
        print("Required library 'PyQt5' is missing. Installing...")
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "PyQt5"])
            print("Successfully installed PyQt5.")
        except Exception as e:
            print(f"Error installing PyQt5: {e}")
            sys.exit(1)

# Program başlamadan önce kontrol et
check_dependencies()

from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, 
                             QHBoxLayout, QPushButton, QLabel, QTextEdit, 
                             QProgressBar, QFileDialog, QMessageBox, QGroupBox,
                             QLineEdit, QFrame)
from PyQt5.QtCore import Qt, QThread, pyqtSignal
from PyQt5.QtGui import QFont, QIcon

class CopyWorker(QThread):
    """Arka planda kopyalama işlemini yürüten thread"""
    progress_signal = pyqtSignal(int)
    log_signal = pyqtSignal(str)
    finished_signal = pyqtSignal(dict)
    
    def __init__(self, base_folder, telegram_source):
        super().__init__()
        self.base_folder = base_folder
        self.telegram_source = telegram_source
        self.running = True
        
    def run(self):
        try:
            self.log_signal.emit("🚀 Kopyalama işlemi başlatılıyor...")
            self.log_signal.emit(f"📁 Ana klasör: {self.base_folder}")
            self.log_signal.emit(f"📄 Kaynak telegram.exe: {self.telegram_source}")
            self.log_signal.emit("-" * 50)
            
            # Alt klasörleri bul
            subfolders = []
            for item in os.listdir(self.base_folder):
                item_path = os.path.join(self.base_folder, item)
                if os.path.isdir(item_path):
                    subfolders.append(item_path)
            
            if not subfolders:
                self.log_signal.emit("❌ Alt klasör bulunamadı!")
                self.finished_signal.emit({"success": False, "message": "Alt klasör bulunamadı"})
                return
            
            self.log_signal.emit(f"📋 {len(subfolders)} adet alt klasör bulundu")
            self.log_signal.emit("-" * 50)
            
            # İstatistikler
            successful_copies = 0
            skipped_copies = 0
            failed_copies = 0
            
            # Her alt klasöre telegram.exe kopyala
            for i, subfolder in enumerate(subfolders, 1):
                if not self.running:
                    self.log_signal.emit("⏹️ İşlem kullanıcı tarafından durduruldu.")
                    break
                    
                subfolder_name = os.path.basename(subfolder)
                target_path = os.path.join(subfolder, "telegram.exe")
                
                self.log_signal.emit(f"[{i}/{len(subfolders)}] {subfolder_name} işleniyor...")
                
                # Kontrol: Hedef klasörde zaten telegram.exe var mı?
                if os.path.exists(target_path):
                    self.log_signal.emit(f"   ⚠️  Zaten mevcut, atlanıyor")
                    skipped_copies += 1
                    continue
                
                try:
                    # telegram.exe'yi kopyala
                    shutil.copy2(self.telegram_source, target_path)
                    self.log_signal.emit(f"   ✅ Başarıyla kopyalandı")
                    successful_copies += 1
                    
                except Exception as e:
                    self.log_signal.emit(f"   ❌ Kopyalama hatası: {e}")
                    failed_copies += 1
                
                # Progress bar güncelle
                progress = int((i / len(subfolders)) * 100)
                self.progress_signal.emit(progress)
            
            # Sonuçları göster
            self.log_signal.emit("-" * 50)
            self.log_signal.emit("📊 KOPYALAMA SONUÇLARI:")
            self.log_signal.emit(f"✅ Başarılı: {successful_copies}")
            self.log_signal.emit(f"⚠️  Atlanan: {skipped_copies}")
            self.log_signal.emit(f"❌ Başarısız: {failed_copies}")
            self.log_signal.emit(f"📁 Toplam klasör: {len(subfolders)}")
            
            if successful_copies > 0:
                self.log_signal.emit(f"\n🎉 {successful_copies} klasöre telegram.exe başarıyla kopyalandı!")
                self.finished_signal.emit({
                    "success": True, 
                    "successful": successful_copies,
                    "skipped": skipped_copies,
                    "failed": failed_copies,
                    "total": len(subfolders)
                })
            else:
                self.log_signal.emit(f"\n⚠️  Hiçbir kopyalama yapılamadı!")
                self.finished_signal.emit({"success": False, "message": "Hiçbir kopyalama yapılamadı"})
                
        except Exception as e:
            self.log_signal.emit(f"❌ Beklenmeyen hata: {e}")
            self.finished_signal.emit({"success": False, "message": str(e)})
    
    def stop(self):
        self.running = False

class TelegramCopierGUI(QMainWindow):
    def __init__(self):
        super().__init__()
        self.copy_worker = None
        self.init_ui()
        
    def init_ui(self):
        self.setWindowTitle("Telegram.exe Kopyalayıcı")
        self.setGeometry(100, 100, 800, 600)
        self.setStyleSheet("""
            QMainWindow {
                background-color: #2b2b2b;
                color: #ffffff;
            }
            QWidget {
                background-color: #2b2b2b;
                color: #ffffff;
                font-family: 'Segoe UI', Arial;
                font-size: 10pt;
            }
            QGroupBox {
                border: 2px solid #404040;
                border-radius: 8px;
                margin-top: 10px;
                padding-top: 10px;
                font-weight: bold;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 10px;
                padding: 0 5px 0 5px;
                color: #4ec9b0;
            }
            QPushButton {
                background-color: #0078d4;
                border: none;
                border-radius: 5px;
                padding: 8px 16px;
                font-weight: bold;
                color: white;
            }
            QPushButton:hover {
                background-color: #106ebe;
            }
            QPushButton:pressed {
                background-color: #005a9e;
            }
            QPushButton:disabled {
                background-color: #404040;
                color: #808080;
            }
            QLineEdit {
                background-color: #3c3c3c;
                border: 1px solid #404040;
                border-radius: 4px;
                padding: 6px;
                color: #ffffff;
            }
            QLineEdit:focus {
                border: 1px solid #0078d4;
            }
            QTextEdit {
                background-color: #1e1e1e;
                border: 1px solid #404040;
                border-radius: 4px;
                color: #ffffff;
                font-family: 'Consolas', 'Courier New', monospace;
                font-size: 9pt;
            }
            QProgressBar {
                border: 1px solid #404040;
                border-radius: 4px;
                text-align: center;
                background-color: #3c3c3c;
            }
            QProgressBar::chunk {
                background-color: #4ec9b0;
                border-radius: 3px;
            }
        """)
        
        # Ana widget
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        layout = QVBoxLayout(central_widget)
        
        # Başlık
        title_label = QLabel("🚀 TELEGRAM.EXE KOPYALAYICI")
        title_label.setAlignment(Qt.AlignCenter)
        title_label.setStyleSheet("font-size: 18pt; font-weight: bold; color: #4ec9b0; margin: 10px;")
        layout.addWidget(title_label)
        
        # Ayarlar grubu
        settings_group = QGroupBox("📁 Klasör ve Dosya Seçimi")
        settings_layout = QVBoxLayout(settings_group)
        
        # Base folder seçimi
        base_folder_layout = QHBoxLayout()
        base_folder_layout.addWidget(QLabel("Ana Klasör:"))
        self.base_folder_input = QLineEdit()
        self.base_folder_input.setPlaceholderText("Kopyalama yapılacak ana klasörü seçin...")
        base_folder_layout.addWidget(self.base_folder_input)
        self.select_base_folder_btn = QPushButton("📂 Seç")
        self.select_base_folder_btn.clicked.connect(self.select_base_folder)
        base_folder_layout.addWidget(self.select_base_folder_btn)
        settings_layout.addLayout(base_folder_layout)
        
        # Telegram.exe seçimi
        telegram_layout = QHBoxLayout()
        telegram_layout.addWidget(QLabel("Telegram.exe:"))
        self.telegram_input = QLineEdit()
        self.telegram_input.setPlaceholderText("Kopyalanacak telegram.exe dosyasını seçin...")
        telegram_layout.addWidget(self.telegram_input)
        self.select_telegram_btn = QPushButton("📄 Seç")
        self.select_telegram_btn.clicked.connect(self.select_telegram_file)
        telegram_layout.addWidget(self.select_telegram_btn)
        settings_layout.addLayout(telegram_layout)
        
        layout.addWidget(settings_group)
        
        # Kontrol butonları
        control_layout = QHBoxLayout()
        self.start_btn = QPushButton("🚀 KOPYALAMAYI BAŞLAT")
        self.start_btn.clicked.connect(self.start_copying)
        self.start_btn.setEnabled(False)
        control_layout.addWidget(self.start_btn)
        
        self.stop_btn = QPushButton("⏹️ DURDUR")
        self.stop_btn.clicked.connect(self.stop_copying)
        self.stop_btn.setEnabled(False)
        control_layout.addWidget(self.stop_btn)
        
        layout.addLayout(control_layout)
        
        # Progress bar
        self.progress_bar = QProgressBar()
        self.progress_bar.setVisible(False)
        layout.addWidget(self.progress_bar)
        
        # Log alanı
        log_group = QGroupBox("📋 İşlem Logları")
        log_layout = QVBoxLayout(log_group)
        self.log_text = QTextEdit()
        self.log_text.setReadOnly(True)
        log_layout.addWidget(self.log_text)
        layout.addWidget(log_group)
        
        # Durum çubuğu
        self.status_label = QLabel("Hazır")
        self.status_label.setStyleSheet("color: #808080; padding: 5px;")
        layout.addWidget(self.status_label)
        
        self.log_message("🎯 Telegram.exe Kopyalayıcı başlatıldı")
        self.log_message("📝 Lütfen ana klasör ve telegram.exe dosyasını seçin")
        
    def select_base_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Ana Klasör Seç")
        if folder:
            self.base_folder_input.setText(folder)
            self.check_ready_state()
            self.log_message(f"📁 Ana klasör seçildi: {folder}")
    
    def select_telegram_file(self):
        file, _ = QFileDialog.getOpenFileName(self, "Telegram.exe Seç", "", "Executable Files (*.exe)")
        if file:
            self.telegram_input.setText(file)
            self.check_ready_state()
            self.log_message(f"📄 Telegram.exe seçildi: {file}")
    
    def check_ready_state(self):
        base_folder = self.base_folder_input.text().strip()
        telegram_file = self.telegram_input.text().strip()
        
        if base_folder and telegram_file:
            self.start_btn.setEnabled(True)
            self.status_label.setText("Başlatmaya hazır")
            self.status_label.setStyleSheet("color: #4ec9b0; padding: 5px;")
        else:
            self.start_btn.setEnabled(False)
            self.status_label.setText("Klasör ve dosya seçimi gerekli")
            self.status_label.setStyleSheet("color: #808080; padding: 5px;")
    
    def start_copying(self):
        base_folder = self.base_folder_input.text().strip()
        telegram_file = self.telegram_input.text().strip()
        
        # Kontroller
        if not os.path.exists(base_folder):
            QMessageBox.warning(self, "Hata", "Seçilen ana klasör mevcut değil!")
            return
        
        if not os.path.exists(telegram_file):
            QMessageBox.warning(self, "Hata", "Seçilen telegram.exe dosyası mevcut değil!")
            return
        
        # UI durumunu güncelle
        self.start_btn.setEnabled(False)
        self.stop_btn.setEnabled(True)
        self.progress_bar.setVisible(True)
        self.progress_bar.setValue(0)
        self.status_label.setText("Kopyalama işlemi çalışıyor...")
        self.status_label.setStyleSheet("color: #ffc400; padding: 5px;")
        
        # Worker thread'i başlat
        self.copy_worker = CopyWorker(base_folder, telegram_file)
        self.copy_worker.progress_signal.connect(self.update_progress)
        self.copy_worker.log_signal.connect(self.log_message)
        self.copy_worker.finished_signal.connect(self.copying_finished)
        self.copy_worker.start()
        
        self.log_message("🔄 Kopyalama işlemi başlatıldı...")
    
    def stop_copying(self):
        if self.copy_worker and self.copy_worker.isRunning():
            self.copy_worker.stop()
            self.log_message("⏹️ Durdurma sinyali gönderildi...")
    
    def update_progress(self, value):
        self.progress_bar.setValue(value)
    
    def copying_finished(self, result):
        # UI durumunu sıfırla
        self.start_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)
        self.progress_bar.setVisible(False)
        
        if result["success"]:
            self.status_label.setText("Kopyalama başarıyla tamamlandı!")
            self.status_label.setStyleSheet("color: #4ec9b0; padding: 5px;")
            
            # Başarı mesajı göster
            msg = f"✅ Kopyalama tamamlandı!\n\n"
            msg += f"✅ Başarılı: {result.get('successful', 0)}\n"
            msg += f"⚠️ Atlanan: {result.get('skipped', 0)}\n"
            msg += f"❌ Başarısız: {result.get('failed', 0)}\n"
            msg += f"📁 Toplam: {result.get('total', 0)}"
            
            QMessageBox.information(self, "Başarılı", msg)
        else:
            self.status_label.setText("Kopyalama başarısız!")
            self.status_label.setStyleSheet("color: #f44747; padding: 5px;")
            QMessageBox.warning(self, "Hata", f"Kopyalama başarısız: {result.get('message', 'Bilinmeyen hata')}")
    
    def log_message(self, message):
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_text.append(f"[{timestamp}] {message}")
        # Otomatik scroll
        self.log_text.verticalScrollBar().setValue(self.log_text.verticalScrollBar().maximum())
    
    def closeEvent(self, event):
        if self.copy_worker and self.copy_worker.isRunning():
            reply = QMessageBox.question(self, 'Çıkış Onayı', 
                                       "Kopyalama işlemi devam ediyor. Çıkmak istediğinizden emin misiniz?",
                                       QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
            if reply == QMessageBox.Yes:
                self.copy_worker.stop()
                self.copy_worker.wait(3000)  # 3 saniye bekle
                event.accept()
            else:
                event.ignore()
        else:
            event.accept()

def main():
    app = QApplication(sys.argv)
    app.setApplicationName("Telegram.exe Kopyalayıcı")
    
    window = TelegramCopierGUI()
    window.show()
    
    sys.exit(app.exec_())

if __name__ == "__main__":
    main()
