// src/google-drive/google-drive.service.ts
import { Injectable } from '@nestjs/common';
import { blue, green } from 'colorette';
import { log } from 'console';
import * as fs from 'fs';
import { google } from 'googleapis';
import { EnvEnum } from 'src/my-config/env-enum';
import { MyConfigService } from 'src/my-config/my-config.service';
import { Readable } from 'stream';
import { CreateFolderProps, FileProps } from './props/create-folder.props';

@Injectable()
export class GoogleDriveService {
  private oAuth2Client: any;
  private drive: any;
  constructor(private myConfigService: MyConfigService) {
    this.initializeOAuth2Client();
  }

  private async initializeOAuth2Client(): Promise<void> {
    this.oAuth2Client = new google.auth.OAuth2(
      this.myConfigService.get(EnvEnum.GOOGLE_DRIVE_CLIENT_ID),
      this.myConfigService.get(EnvEnum.GOOGLE_DRIVE_CLIENT_SECRET),
      this.myConfigService.get(EnvEnum.GOOGLE_DRIVE_REDIRECT_URL_1),
    );
    this.oAuth2Client.setCredentials({
      refresh_token: this.myConfigService.get(
        EnvEnum.GOOGLE_DRIVE_REFRESH_TOKEN,
      ),
    });
    this.drive = google.drive({ version: 'v3', auth: this.oAuth2Client });
  }

  async uploadFileToDrive({
    localPath,
    filename, // the file name with his mime type with timestamp
    mimetype,
    folderDriveId,
    originalname, // the file name with his mime type
  }: FileProps): Promise<string> {
    log('uploadFileToDrive')
    log(localPath)
    // if (!fs.existsSync(localPath)) {
    //   console.error(`File not found: ${localPath}`);
    //   return; // or throw an error, depending on your error handling strategy
    // }
    const fileBuffer = await fs.readFileSync(localPath);

    const fileMetadata = {
      name: originalname, // Set your desired file name
      parents: [folderDriveId], // Set the parent folder ID
    };

    const media = {
      mimeType: mimetype, // Set your file's MIME type\

      body: new Readable({
        read() {
          this.push(Buffer.from(fileBuffer.buffer));
          this.push(null);
        },
      }),
    };
    log('uploadFileToDrive 2 ')

    try {
      // Upload the file to Google Drive
      const file = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id',
      });
      log('uploadFileToDrive 3 ')

      const fileId = file?.data.id;

      // Update permissions for the uploaded file to make it public
      await this.updateFilePermissions(fileId);
      log('uploadFileToDrive updateFilePermissions ')

      // Get the public link instead of the embedded link
      const publicLink = this.getShareableLink(fileId);
      return publicLink;
    } catch (error) {
      console.error(
        'Error uploading local file to Google Drive:',
        error.message,
      );
      throw new Error('Failed to upload local file to Google Drive.');
    }
  }
  async createFolder({
    folderName,
    parentFolderId,
  }: CreateFolderProps): Promise<string> {
    const requestBody: any = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    };
    requestBody.parents = [parentFolderId];
    const folderDriveData = await this.drive.files.create({
      requestBody,
    });

    return folderDriveData.data.id;
  }
  private async updateFilePermissions(fileId: string): Promise<void> {
    try {
      await this.drive.permissions.create({
        fileId: fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });
    } catch (error) {
      console.error('Error updating file permissions:', error.message);
      throw new Error('Failed to update file permissions.');
    }
  }
  private getShareableLink(fileId: string): string {
    log(
      blue(`uploaded to drive :`) +
        green(`https://lh3.googleusercontent.com/d/${fileId}`),
    );
    return `https://lh3.googleusercontent.com/d/${fileId}`
    // return `https://drive.google.com/uc?id=${fileId}`;
  }
  private getDownloadLink(link: string): string {
    return link + '&export=download';
  }
}
